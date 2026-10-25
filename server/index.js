import 'dotenv/config';
import express from 'express';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const app = express();
const port = process.env.PORT || 3001;
app.use(express.json({ limit: '20kb' }));

const freeNewsCache = new Map();
const imageSources = new Map();
let freeNewsQueue = Promise.resolve();
let lastFreeNewsRequestAt = 0;

function freeNewsErrorResponse(response, status, message) {
  const mappedStatus = status === 404 ? 404 : status === 429 ? 429 : 502;
  const fallback = mappedStatus === 429
    ? 'The news service is receiving too many requests. Please try again shortly.'
    : 'The news service could not return articles for this request.';
  return response.status(mappedStatus).json({ error: message || fallback });
}

function validPublisherUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return '';
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : '';
  } catch {
    return '';
  }
}

function isPublicAddress(address) {
  const version = isIP(address);
  if (version === 4) {
    const [a, b, c] = address.split('.').map(Number);
    return !(
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && ((b === 0 && c === 0) || b === 168)) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113)
    );
  }
  if (version === 6) {
    const normalized = address.toLowerCase();
    return !(
      normalized === '::' || normalized === '::1' || normalized.startsWith('::ffff:') ||
      normalized.startsWith('fc') || normalized.startsWith('fd') ||
      normalized.startsWith('fe8') || normalized.startsWith('fe9') ||
      normalized.startsWith('fea') || normalized.startsWith('feb') ||
      normalized.startsWith('ff') || normalized.startsWith('2001:db8:')
    );
  }
  return false;
}

async function assertPublicHttpsUrl(value) {
  const url = new URL(value);
  if (url.protocol === 'http:') url.protocol = 'https:';
  if (url.protocol !== 'https:' || !url.hostname) throw new Error('Image URLs must use HTTPS.');
  if (isIP(url.hostname)) {
    if (!isPublicAddress(url.hostname)) throw new Error('Image URL points to a private address.');
    return url;
  }
  const addresses = await lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) {
    throw new Error('Image host did not resolve to a public address.');
  }
  return url;
}

async function fetchPublicUrl(value, headers) {
  let url = await assertPublicHttpsUrl(value);
  for (let redirects = 0; redirects <= 4; redirects += 1) {
    const upstream = await fetch(url, {
      headers,
      redirect: 'manual',
      signal: AbortSignal.timeout(12000),
    });
    if (![301, 302, 303, 307, 308].includes(upstream.status)) return { upstream, url };
    const location = upstream.headers.get('location');
    await upstream.body?.cancel();
    if (!location || redirects === 4) throw new Error('Image host returned too many redirects.');
    url = await assertPublicHttpsUrl(new URL(location, url).href);
  }
  throw new Error('Image host returned too many redirects.');
}

async function readLimitedBody(upstream, maxBytes, truncate = false) {
  const reader = upstream.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const availableBytes = maxBytes - totalBytes;
    if (value.byteLength > availableBytes && truncate) {
      if (availableBytes > 0) {
        chunks.push(Buffer.from(value.subarray(0, availableBytes)));
        totalBytes += availableBytes;
      }
      await reader.cancel();
      break;
    }
    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel();
      throw new Error('Image response exceeded the size limit.');
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, totalBytes);
}

function decodeHtmlAttribute(value) {
  return value
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)));
}

function extractPageImage(html, pageUrl) {
  const tags = html.match(/<meta\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const keyMatch = tag.match(/\b(?:property|name)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s/>]+))/i);
    const contentMatch = tag.match(/\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s/>]+))/i);
    const key = (keyMatch?.[1] || keyMatch?.[2] || keyMatch?.[3] || '').toLowerCase();
    const content = contentMatch?.[1] || contentMatch?.[2] || contentMatch?.[3] || '';
    if (['og:image', 'og:image:url', 'twitter:image', 'twitter:image:src'].includes(key) && content) {
      try {
        const imageUrl = new URL(decodeHtmlAttribute(content), pageUrl);
        if (imageUrl.protocol === 'https:') return imageUrl.href;
      } catch {
        // Keep looking for another usable image tag.
      }
    }
  }
  return '';
}

async function getImageResource(imageUrl) {
  if (!imageUrl) return null;
  const image = await fetchPublicUrl(imageUrl, {
    accept: 'image/avif,image/webp,image/apng,image/*;q=0.9,*/*;q=0.5',
    'user-agent': 'Mozilla/5.0 (compatible; ClearView/1.0)',
  });
  const contentType = (image.upstream.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!image.upstream.ok || !contentType.startsWith('image/') || contentType === 'image/svg+xml') {
    await image.upstream.body?.cancel();
    return null;
  }
  const bytes = await readLimitedBody(image.upstream, 8 * 1024 * 1024);
  return bytes.length ? { bytes, contentType } : null;
}

function freeNewsRequest(path) {
  const cacheKey = path;
  const cached = freeNewsCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.payload);

  const request = freeNewsQueue.then(async () => {
    const freshCache = freeNewsCache.get(cacheKey);
    if (freshCache && freshCache.expiresAt > Date.now()) return freshCache.payload;

    // Stay comfortably below FreeNewsAPI.ai's documented 20-requests-per-second limit.
    const waitMs = Math.max(0, 100 - (Date.now() - lastFreeNewsRequestAt));
    if (waitMs) await new Promise((resolve) => setTimeout(resolve, waitMs));
    lastFreeNewsRequestAt = Date.now();

    const upstream = await fetch(`https://freenewsapi.ai/v1/${path}`, {
      signal: AbortSignal.timeout(12000),
    });
    const payload = await upstream.json();
    if (!upstream.ok) {
      const error = new Error(payload.message || payload.error?.message || payload.error || 'FreeNewsAPI.ai request failed.');
      error.status = upstream.status;
      throw error;
    }

    const ttlMs = path.startsWith('article?') ? 10 * 60 * 1000 : 60 * 1000;
    freeNewsCache.set(cacheKey, { payload, expiresAt: Date.now() + ttlMs });
    if (freeNewsCache.size > 100) {
      for (const [key, value] of freeNewsCache) {
        if (value.expiresAt <= Date.now()) freeNewsCache.delete(key);
      }
      while (freeNewsCache.size > 100) freeNewsCache.delete(freeNewsCache.keys().next().value);
    }
    return payload;
  });

  freeNewsQueue = request.catch(() => undefined);
  return request;
}

app.get('/api/articles', async (request, response) => {
  const query = typeof request.query.q === 'string' ? request.query.q.trim().slice(0, 200) : '';
  const params = new URLSearchParams({ country: 'IN', lang: 'en,hi', sort: 'date', size: '10', offset: '0' });
  if (query) params.set('q', query);

  try {
    const payload = await freeNewsRequest(`search?${params}`);
    const articles = (payload.results || []).map((article) => {
      const articleUrl = validPublisherUrl(article.url);
      const articleId = typeof article.id === 'string' ? article.id : '';
      const imageSource = validPublisherUrl(article.image);
      if (articleId && articleUrl) {
        imageSources.set(articleId, {
          articleUrl,
          imageUrl: imageSource,
          expiresAt: Date.now() + 30 * 60 * 1000,
        });
      }
      return {
        id: articleId,
        outlet: article.sitename || article.host || 'News source',
        language: article.lang || 'en',
        date: article.published_at
          ? new Date(article.published_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
          : 'Date unavailable',
        category: query ? 'SEARCH' : 'INDIA',
        title: article.title || 'Untitled story',
        description: article.description || 'Open the publisher article or check the full text.',
        url: articleUrl,
        imageUrl: articleId && articleUrl && (imageSource || articleUrl) ? `/api/images/${articleId}` : '',
      };
    });
    if (imageSources.size > 300) {
      for (const [id, source] of imageSources) {
        if (source.expiresAt <= Date.now()) imageSources.delete(id);
      }
      while (imageSources.size > 300) imageSources.delete(imageSources.keys().next().value);
    }

    return response.json({ totalArticles: articles.length, hasMore: Number(payload.total) > articles.length, articles });
  } catch (error) {
    console.error('FreeNewsAPI request failed:', error.message);
    if (error.status) return freeNewsErrorResponse(response, error.status, error.message);
    return response.status(502).json({ error: 'Could not reach FreeNewsAPI. Check your connection and try again.' });
  }
});

app.get('/api/images/:articleId', async (request, response) => {
  const { articleId } = request.params;
  if (!/^[a-f0-9]{32}$/i.test(articleId)) return response.status(400).end();
  const source = imageSources.get(articleId);
  if (!source || source.expiresAt <= Date.now()) {
    imageSources.delete(articleId);
    return response.status(404).end();
  }

  try {
    let resource = null;
    try {
      resource = await getImageResource(source.imageUrl);
    } catch (error) {
      console.warn(`API image URL failed for article ${articleId}:`, error.message);
    }
    if (!resource) {
      const page = await fetchPublicUrl(source.articleUrl, {
        accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
        'user-agent': 'Mozilla/5.0 (compatible; ClearView/1.0)',
      });
      if (!page.upstream.ok || !(page.upstream.headers.get('content-type') || '').includes('text/html')) {
        await page.upstream.body?.cancel();
        return response.status(404).end();
      }
      const html = (await readLimitedBody(page.upstream, 1024 * 1024, true)).toString('utf8');
      resource = await getImageResource(extractPageImage(html, page.url.href));
    }
    if (!resource) return response.status(404).end();
    response.set({
      'Content-Type': resource.contentType,
      'Content-Length': String(resource.bytes.length),
      'Cache-Control': 'public, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
    });
    return response.send(resource.bytes);
  } catch (error) {
    console.error(`Image proxy failed for article ${articleId}:`, error.message);
    return response.status(502).end();
  }
});

app.post('/api/analyze', async (request, response) => {
  const { articleId, articleUrl } = request.body ?? {};
  const publisherUrl = validPublisherUrl(articleUrl);
  if (typeof articleId !== 'string' || !articleId.trim() || !publisherUrl) {
    return response.status(400).json({ error: 'Provide an article id and publisher URL to check.' });
  }

  try {
    const articleParams = new URLSearchParams({ url: publisherUrl, full_text: 'true' });
    const article = await freeNewsRequest(`article?${articleParams}`);
    const hasFullArticle = typeof article.text === 'string' && article.text.trim().length > 0;
    const text = (hasFullArticle ? article.text : article.description) || article.title || '';
    if (!text.trim()) return response.status(404).json({ error: 'FreeNewsAPI did not return article text for this story.' });
    const analysisResponse = await fetch(`${process.env.ANALYSIS_SERVICE_URL || 'http://localhost:8000'}/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        article_id: articleId.slice(0, 100),
        title: article.title || '',
        text,
        assessment_basis: hasFullArticle ? 'full_article' : 'description',
        publisher: article.sitename || article.host || '',
        authors: article.author ? [article.author] : [],
        url: publisherUrl,
      }),
      signal: AbortSignal.timeout(120000),
    });
    const result = await analysisResponse.json();
    if (!analysisResponse.ok) {
      return response.status(analysisResponse.status).json({ error: result.detail || result.error || 'The AI review could not be completed.' });
    }
    return response.status(analysisResponse.status).json(result);
  } catch (error) {
    if (error.status) return freeNewsErrorResponse(response, error.status, error.message);
    console.error('Article analysis request failed:', error.message);
    return response.status(503).json({ error: 'The Python analysis service is not available. Start it with the project dev command.' });
  }
});

app.listen(port, () => {
  console.log(`ClearView API is running at http://localhost:${port}`);
});

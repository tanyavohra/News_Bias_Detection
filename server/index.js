import 'dotenv/config';
import express from 'express';

const app = express();
const port = process.env.PORT || 3001;
app.use(express.json({ limit: '20kb' }));

const freeNewsCache = new Map();
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
    const articles = (payload.results || []).map((article) => ({
      id: article.id,
      outlet: article.sitename || article.host || 'News source',
      language: article.lang || 'en',
      date: article.published_at
        ? new Date(article.published_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
        : 'Date unavailable',
      category: query ? 'SEARCH' : 'INDIA',
      title: article.title || 'Untitled story',
      description: article.description || 'Open the publisher article or check the full text.',
      url: validPublisherUrl(article.url),
      imageUrl: article.image || '',
    }));

    return response.json({ totalArticles: articles.length, hasMore: Number(payload.total) > articles.length, articles });
  } catch (error) {
    console.error('FreeNewsAPI request failed:', error.message);
    if (error.status) return freeNewsErrorResponse(response, error.status, error.message);
    return response.status(502).json({ error: 'Could not reach FreeNewsAPI. Check your connection and try again.' });
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
    const text = article.text || article.description || article.title || '';
    if (!text.trim()) return response.status(404).json({ error: 'FreeNewsAPI did not return article text for this story.' });
    const analysisResponse = await fetch(`${process.env.ANALYSIS_SERVICE_URL || 'http://localhost:8000'}/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        article_id: articleId.slice(0, 100),
        title: article.title || '',
        text,
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

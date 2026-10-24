import 'dotenv/config';
import express from 'express';

const app = express();
const port = process.env.PORT || 3001;
app.use(express.json({ limit: '20kb' }));

const INDIA_PUBLISHERS = new Set([
  'the hindu', 'the times of india', 'indian express', 'the indian express',
  'hindustan times', 'india today', 'ndtv', 'the print', 'scroll.in',
  'deccan herald', 'mint', 'business standard', 'the economic times',
  'the hindu businessline', 'news18', 'firstpost', 'the wire', 'telegraph india',
  'the tribune', 'the quint', 'outlook india', 'livemint', 'ani',
]);
const freeNewsCache = new Map();
let freeNewsQueue = Promise.resolve();
let lastFreeNewsRequestAt = 0;

function freeNewsErrorResponse(response, status, message) {
  const mappedStatus = status === 401 || status === 403 ? status : status === 429 ? 429 : 502;
  const fallback = mappedStatus === 401 || mappedStatus === 403
    ? 'FreeNewsAPI rejected the key. Check FREE_NEWS_API_KEY in .env and restart ClearView.'
    : mappedStatus === 429
      ? 'FreeNewsAPI request quota reached. Please try again later.'
      : 'FreeNewsAPI could not return articles for this request.';
  return response.status(mappedStatus).json({ error: message || fallback });
}

function freeNewsRequest(path, apiKey) {
  const cacheKey = path;
  const cached = freeNewsCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.payload);

  const request = freeNewsQueue.then(async () => {
    const freshCache = freeNewsCache.get(cacheKey);
    if (freshCache && freshCache.expiresAt > Date.now()) return freshCache.payload;

    // Stay just under FreeNewsAPI's documented two-requests-per-second limit.
    const waitMs = Math.max(0, 600 - (Date.now() - lastFreeNewsRequestAt));
    if (waitMs) await new Promise((resolve) => setTimeout(resolve, waitMs));
    lastFreeNewsRequestAt = Date.now();

    const upstream = await fetch(`https://api.freenewsapi.io/v1/${path}`, {
      headers: { 'x-api-key': apiKey },
      signal: AbortSignal.timeout(12000),
    });
    const payload = await upstream.json();
    if (!upstream.ok) {
      const error = new Error(payload.message || payload.error || 'FreeNewsAPI request failed.');
      error.status = upstream.status;
      throw error;
    }

    const ttlMs = path.startsWith('details?') ? 10 * 60 * 1000 : 60 * 1000;
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
  const apiKey = process.env.FREE_NEWS_API_KEY || process.env.FREE_NEWS_API_ORG;
  if (!apiKey) {
    return response.status(503).json({ error: 'Add your FreeNewsAPI key as FREE_NEWS_API_KEY to the .env file, then restart ClearView.' });
  }

  const query = typeof request.query.q === 'string' ? request.query.q.trim().slice(0, 200) : '';
  const params = new URLSearchParams({ language: 'en', country: 'IN', order_by: 'recent', offset: '0' });
  if (query) params.set('in_title', query.split(/\s+/).slice(0, 5).join(' '));

  try {
    const candidates = [];
    let hasMore = true;
    // The provider's country filter is broad in practice, so enforce India
    // publisher names here and page through a few batches to fill the feed.
    for (let offset = 0; offset < 50 && candidates.length < 10; offset += 10) {
      params.set('offset', String(offset));
      const payload = await freeNewsRequest(`news?${params}`, apiKey);
      const batch = (payload.data || []).filter((article) => INDIA_PUBLISHERS.has((article.publisher || '').trim().toLowerCase()));
      candidates.push(...batch);
      hasMore = Boolean(payload.meta?.has_more);
      if (!hasMore) break;
    }

    const articles = candidates.slice(0, 10).map((article) => ({
      id: article.uuid,
      outlet: article.publisher || 'News source',
      date: article.published_at
        ? new Date(article.published_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
        : 'Date unavailable',
      category: query ? 'SEARCH' : 'INDIA',
      title: article.title || 'Untitled story',
      description: article.incipit || 'Open the publisher article or check the full text.',
      url: article.original_url || '',
      imageUrl: article.thumbnail || '',
    }));

    return response.json({ totalArticles: articles.length, hasMore, articles });
  } catch (error) {
    console.error('FreeNewsAPI request failed:', error.message);
    if (error.status) return freeNewsErrorResponse(response, error.status, error.message);
    return response.status(502).json({ error: 'Could not reach FreeNewsAPI. Check your connection and try again.' });
  }
});

app.post('/api/analyze', async (request, response) => {
  const { articleId } = request.body ?? {};
  if (typeof articleId !== 'string' || !articleId.trim()) {
    return response.status(400).json({ error: 'Provide an article id to check.' });
  }

  try {
    const apiKey = process.env.FREE_NEWS_API_KEY || process.env.FREE_NEWS_API_ORG;
    if (!apiKey) return response.status(503).json({ error: 'Add your FreeNewsAPI key as FREE_NEWS_API_KEY to the .env file, then restart ClearView.' });
    const details = await freeNewsRequest(`details?${new URLSearchParams({ uuid: articleId })}`, apiKey);
    const article = details.data;
    const text = article?.body || article?.incipit || article?.title || '';
    if (!text.trim()) return response.status(404).json({ error: 'FreeNewsAPI did not return article text for this story.' });
    const analysisResponse = await fetch(`${process.env.ANALYSIS_SERVICE_URL || 'http://localhost:8000'}/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        article_id: articleId.slice(0, 100),
        title: article.title || '',
        text,
        publisher: article.publisher || '',
        authors: Array.isArray(article.authors) ? article.authors : [],
        url: article.original_url || '',
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

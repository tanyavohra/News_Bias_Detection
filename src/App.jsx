import { useEffect, useState } from 'react';

const CRITERIA_GROUPS = [
  { title: 'Author & Publisher Intent', ids: ['conflicts_of_interest', 'organization_reputation'] },
  { title: 'Structure & Framing', ids: ['headline_accuracy', 'bias_by_omission', 'story_placement'] },
  { title: 'Sources & Representation', ids: ['source_diversity', 'citations_and_links', 'quote_integrity'] },
  { title: 'Evidence & Factuality', ids: ['verifiable_data', 'fact_opinion_distinction', 'logical_fallacies'] },
  { title: 'Language & Tone', ids: ['loaded_words', 'tone', 'vague_attribution'] },
];

function App() {
  const [searchTerm, setSearchTerm] = useState('');
  const [articles, setArticles] = useState([]);
  const [failedImageIds, setFailedImageIds] = useState(() => new Set());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [activeAnalysisId, setActiveAnalysisId] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisError, setAnalysisError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      setLoadError('');
      const query = searchTerm.trim();
      const path = query ? `/api/articles?q=${encodeURIComponent(query)}` : '/api/articles';
      try {
        const response = await fetch(path, { signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'The news feed could not be loaded.');
        setArticles(data.articles);
        setActiveAnalysisId(null);
        setAnalysis(null);
      } catch (error) {
        if (error.name !== 'AbortError') {
          setLoadError(error.message || 'Could not connect to the India news feed.');
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 500);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [searchTerm]);

  async function checkArticle(article) {
    if (activeAnalysisId === article.id) {
      setActiveAnalysisId(null);
      return;
    }

    setActiveAnalysisId(article.id);
    setAnalysis(null);
    setAnalysisError('');
    setAnalysisLoading(true);
    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          articleId: article.id,
          articleUrl: article.url,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'The sample could not be checked.');
      setAnalysis(result);
    } catch (error) {
      setAnalysisError(error.message || 'Could not reach the checker. Make sure the project server is running, then try again.');
    } finally {
      setAnalysisLoading(false);
    }
  }

  return (
    <main className="page-shell">
      <header className="topbar">
        <a className="wordmark" href="#top" aria-label="ClearView home">
          <span className="mark">C</span>
          <span>clearView<span className="wordmark-dot">.</span></span>
        </a>
        <div className="topbar-note"><span className="status-dot" /> Indian headlines · English + हिंदी</div>
      </header>

      <section className="intro" id="top">
        <p className="eyebrow"><span>01</span> &nbsp; THE DAILY BRIEF</p>
        <h1>Read the news.<br /><em>Look a little closer.</em></h1>
        <p className="intro-copy">
          Browse headlines from India, search by topic, and look more closely at the language in each story.
        </p>
        <div className="project-note"><span>✳</span> INDIA · ENGLISH + हिंदी · TOP HEADLINES</div>
      </section>

      <section className="feed" aria-labelledby="feed-heading">
        <div className="feed-heading-row">
          <div>
            <p className="eyebrow muted">LATEST FROM INDIA</p>
            <h2 id="feed-heading">India headlines <span className="story-count">{String(articles.length).padStart(2, '0')}</span></h2>
          </div>
          <label className="search-box">
            <span aria-hidden="true">⌕</span>
            <input
              type="search"
              placeholder="Search India news"
              aria-label="Search India news"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
            />
            <kbd>/</kbd>
          </label>
        </div>

        <div className="article-list">
          {loading ? (
            <div className="empty-state"><p>Loading India headlines…</p></div>
          ) : loadError ? (
            <div className="empty-state"><h3>Headlines are unavailable</h3><p>{loadError}</p></div>
          ) : articles.length > 0 ? articles.map((article, index) => {
            const originalIndex = index;
            return (
            <article className="article-card" key={article.id}>
              <div className="article-index">{String(originalIndex + 1).padStart(2, '0')}</div>
              <div className="article-content">
                <div className="article-meta">
                  <span className="category">{article.category}</span>
                  <span className="article-language">{article.language === 'hi' ? 'हिंदी' : 'ENGLISH'}</span>
                  <span>{article.outlet}</span>
                  <span className="meta-separator">·</span>
                  <time>{article.date}</time>
                </div>
                <h3 lang={article.language}>{article.title}</h3>
                <p lang={article.language}>{article.description}</p>
                <a
                  className="source-link"
                  href={article.url}
                  target="_blank"
                  rel="noreferrer"
                >Read at {article.outlet} <span aria-hidden="true">↗</span></a>
                <button className="check-button" type="button" onClick={() => checkArticle(article)} aria-expanded={activeAnalysisId === article.id}>
                  {activeAnalysisId === article.id ? 'Hide notes' : 'Check this news'} <span aria-hidden="true">{activeAnalysisId === article.id ? '−' : '↗'}</span>
                </button>
              </div>
              {article.imageUrl && !failedImageIds.has(article.id) ? (
                <img
                  className="article-image"
                  src={article.imageUrl}
                  alt=""
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  onError={() => setFailedImageIds((ids) => new Set(ids).add(article.id))}
                />
              ) : (
                <div className={`article-art art-${originalIndex % 3 + 1}`} aria-hidden="true">
                  <span>{article.category}</span><i />
                </div>
              )}
              {activeAnalysisId === article.id && (
                <section className="analysis-panel" aria-live="polite" aria-label={`Language notes for ${article.title}`}>
                  <p className="analysis-label">ARTICLE REVIEW <span>·</span> AI SCORECARD</p>
                  {analysisLoading ? <p className="analysis-message">Generating the summary and reviewing the article…</p> : null}
                  {analysisError ? <p className="analysis-message">{analysisError}</p> : null}
                  {analysis && (
                    <>
                      <div className="neutral-summary">
                        <h4>AI summary <span>· based on article text</span></h4>
                        <p>{analysis.neutralSummary}</p>
                      </div>
                      <div className="neutral-summary score-summary">
                        <h4>Review score <span>· higher means more concerns identified</span></h4>
                        <p>{analysis.overallScore == null ? 'Not enough information to score' : `${analysis.overallScore} / 100`}</p>
                        <p>{analysis.assessedCount} of {analysis.totalCriteria} attributes assessed</p>
                        <p>Bias density: {analysis.biasDensity == null ? 'not available' : `${analysis.biasDensity}%`} ({analysis.flaggedSentenceCount} of {analysis.sentenceCount} sentences with a language or reasoning concern)</p>
                        {analysis.inputTruncated ? <p>Only the first part of this article fit the review limit.</p> : null}
                      </div>
                      <h4 className="signals-heading">Your attributes</h4>
                      {CRITERIA_GROUPS.map((group) => (
                        <section className="criteria-group" key={group.title}>
                          <h4>{group.title}</h4>
                          {analysis.criteria.filter((criterion) => group.ids.includes(criterion.id)).map((criterion) => (
                            <div className="signal-note" key={criterion.id}>
                              <div className="signal-topline">
                                <strong>{criterion.label}</strong>
                                <span>{criterion.status === 'assessed' ? `Concern: ${criterion.score}/4` : 'Not enough information'}</span>
                              </div>
                              <p>{criterion.reason}</p>
                              {criterion.evidence.map((passage, index) => <blockquote key={`${criterion.id}-${index}`}>{passage}</blockquote>)}
                            </div>
                          ))}
                        </section>
                      ))}
                      {analysis.limitations.map((limitation) => <p className="limitations-note" key={limitation}>{limitation}</p>)}
                    </>
                  )}
                </section>
              )}
            </article>
          ); }) : (
            <div className="empty-state">
              <span className="empty-mark">⌕</span>
              <h3>No matching headlines</h3>
              <p>Try another search, or clear the search to return to top headlines.</p>
            </div>
          )}
        </div>
      </section>

      <footer>
        <span>CLEARVIEW <span className="wordmark-dot">✳</span> INDIA NEWS</span>
        <span>Signals invite a closer read; they are not a verdict on a story.</span>
      </footer>
    </main>
  );
}

export default App;

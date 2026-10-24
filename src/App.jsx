import { useEffect, useState } from 'react';

function App() {
  const [searchTerm, setSearchTerm] = useState('');
  const [articles, setArticles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [activeAnalysisId, setActiveAnalysisId] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisError, setAnalysisError] = useState('');

  useEffect(() => {
    fetch('/api/articles')
      .then((response) => {
        if (!response.ok) throw new Error('The sample stories could not be loaded.');
        return response.json();
      })
      .then((data) => setArticles(data.articles))
      .catch(() => setLoadError('Could not connect to the sample stories. Check that the project server is running.'))
      .finally(() => setLoading(false));
  }, []);

  const visibleArticles = articles.filter((article) =>
    `${article.title} ${article.outlet} ${article.category} ${article.description}`
      .toLowerCase()
      .includes(searchTerm.trim().toLowerCase()),
  );

  async function checkArticle(articleId) {
    if (activeAnalysisId === articleId) {
      setActiveAnalysisId(null);
      return;
    }

    setActiveAnalysisId(articleId);
    setAnalysis(null);
    setAnalysisError('');
    setAnalysisLoading(true);
    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ articleId }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'The sample could not be checked.');
      setAnalysis(result);
    } catch {
      setAnalysisError('Could not reach the checker. Make sure the project server is running, then try again.');
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
        <div className="topbar-note"><span className="status-dot" /> A small media literacy project</div>
      </header>

      <section className="intro" id="top">
        <p className="eyebrow"><span>01</span> &nbsp; THE DAILY BRIEF</p>
        <h1>Read the news.<br /><em>Look a little closer.</em></h1>
        <p className="intro-copy">
          Browse a few sample stories, then explore the language and sourcing choices that might be worth a second look.
        </p>
        <div className="project-note"><span>✳</span> Class project · Early version · Sample stories</div>
      </section>

      <section className="feed" aria-labelledby="feed-heading">
        <div className="feed-heading-row">
          <div>
            <p className="eyebrow muted">A STARTING POINT</p>
            <h2 id="feed-heading">Recent stories <span className="story-count">{String(visibleArticles.length).padStart(2, '0')}</span></h2>
          </div>
          <label className="search-box">
            <span aria-hidden="true">⌕</span>
            <input
              type="search"
              placeholder="Search stories"
              aria-label="Search stories"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
            />
            <kbd>/</kbd>
          </label>
        </div>

        <div className="article-list">
          {loading ? (
            <div className="empty-state"><p>Loading sample stories…</p></div>
          ) : loadError ? (
            <div className="empty-state"><h3>Stories are unavailable</h3><p>{loadError}</p></div>
          ) : visibleArticles.length > 0 ? visibleArticles.map((article, index) => {
            const originalIndex = articles.indexOf(article);
            return (
            <article className="article-card" key={article.id}>
              <div className="article-index">{String(originalIndex + 1).padStart(2, '0')}</div>
              <div className="article-content">
                <div className="article-meta">
                  <span className="category">{article.category}</span>
                  <span>{article.outlet}</span>
                  <span className="meta-separator">·</span>
                  <time>{article.date}</time>
                </div>
                <h3>{article.title}</h3>
                <p>{article.description}</p>
                <button className="check-button" type="button" onClick={() => checkArticle(article.id)} aria-expanded={activeAnalysisId === article.id}>
                  {activeAnalysisId === article.id ? 'Hide notes' : 'Check this news'} <span aria-hidden="true">{activeAnalysisId === article.id ? '−' : '↗'}</span>
                </button>
              </div>
              <div className={`article-art art-${originalIndex + 1}`} aria-hidden="true">
                <span>{['CITY\nLIFE', 'FIELD\nNOTES', 'CAMPUS\nDESK'][originalIndex]}</span>
                <i />
              </div>
              {activeAnalysisId === article.id && (
                <section className="analysis-panel" aria-live="polite" aria-label={`Sample notes for ${article.title}`}>
                  <p className="analysis-label">SAMPLE CHECK <span>·</span> RULE-BASED DEMO</p>
                  {analysisLoading ? <p className="analysis-message">Looking for a few language signals…</p> : null}
                  {analysisError ? <p className="analysis-message">{analysisError}</p> : null}
                  {analysis && (
                    <>
                      {analysis.signals.length ? analysis.signals.map((signal) => (
                        <div className="signal-note" key={signal.passage}>
                          <div className="signal-topline"><strong>{signal.category}</strong><span>Uncertainty: {signal.confidence}</span></div>
                          <blockquote>{signal.passage}</blockquote>
                          <p>{signal.explanation}</p>
                        </div>
                      )) : <p className="analysis-message">No words from this small demo list were found in the sample text.</p>}
                      <p className="limitations-note">{analysis.limitations[0]}</p>
                    </>
                  )}
                </section>
              )}
            </article>
          ); }) : (
            <div className="empty-state">
              <span className="empty-mark">⌕</span>
              <h3>No matching stories</h3>
              <p>Try a different word, outlet, or topic.</p>
            </div>
          )}
        </div>
      </section>

      <footer>
        <span>CLEARVIEW <span className="wordmark-dot">✳</span> STUDENT PROJECT</span>
        <span>This tool looks for signals, not a final verdict on a story.</span>
      </footer>
    </main>
  );
}

export default App;

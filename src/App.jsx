import { useState } from 'react';

const articles = [
  {
    outlet: 'The City Ledger',
    date: 'Today, 9:15 AM',
    category: 'LOCAL',
    title: 'Council debates a new plan for the downtown bus lanes',
    description:
      'City officials heard different views from residents and shop owners at Tuesday’s public meeting.',
  },
  {
    outlet: 'Morning Report',
    date: 'Today, 8:40 AM',
    category: 'SCIENCE',
    title: 'Researchers share early results from a coastal water study',
    description:
      'The first set of samples is being reviewed by other researchers before the next phase begins.',
  },
  {
    outlet: 'The Daily Beacon',
    date: 'Yesterday, 6:20 PM',
    category: 'EDUCATION',
    title: 'School board considers changes to the after-school program',
    description:
      'Families and teachers spoke about the proposal, which could change program hours next year.',
  },
];

function App() {
  const [searchTerm, setSearchTerm] = useState('');
  const visibleArticles = articles.filter((article) =>
    `${article.title} ${article.outlet} ${article.category} ${article.description}`
      .toLowerCase()
      .includes(searchTerm.trim().toLowerCase()),
  );

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
          {visibleArticles.length > 0 ? visibleArticles.map((article) => {
            const originalIndex = articles.indexOf(article);
            return (
            <article className="article-card" key={article.title}>
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
                <button className="check-button" type="button" disabled>
                  Check this news <span aria-hidden="true">↗</span>
                </button>
              </div>
              <div className={`article-art art-${originalIndex + 1}`} aria-hidden="true">
                <span>{['CITY\nLIFE', 'FIELD\nNOTES', 'CAMPUS\nDESK'][originalIndex]}</span>
                <i />
              </div>
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

import express from 'express';

const app = express();
const port = process.env.PORT || 3001;

// Temporary sample data for the first backend checkpoint.
const articles = [
  {
    id: 'city-bus-lanes',
    outlet: 'The City Ledger',
    date: 'Today, 9:15 AM',
    category: 'LOCAL',
    title: 'Council debates a new plan for the downtown bus lanes',
    description:
      'City officials heard different views from residents and shop owners at Tuesday’s public meeting.',
    sampleText:
      'City officials heard different views from residents and shop owners at Tuesday’s public meeting. One resident called the proposed bus lane changes a disastrous plan, while a shop owner said the council should wait for more traffic data. The council has not made a final decision.',
  },
  {
    id: 'coastal-water-study',
    outlet: 'Morning Report',
    date: 'Today, 8:40 AM',
    category: 'SCIENCE',
    title: 'Researchers share early results from a coastal water study',
    description:
      'The first set of samples is being reviewed by other researchers before the next phase begins.',
    sampleText:
      'Researchers shared early results from a coastal water study this week. The first set of samples is being reviewed by other researchers before the next phase begins. The team said the findings are preliminary and do not yet show what caused the changes in water quality.',
  },
  {
    id: 'after-school-program',
    outlet: 'The Daily Beacon',
    date: 'Yesterday, 6:20 PM',
    category: 'EDUCATION',
    title: 'School board considers changes to the after-school program',
    description:
      'Families and teachers spoke about the proposal, which could change program hours next year.',
    sampleText:
      'The school board is considering changes to its after-school program. Families and teachers spoke about the proposal at a public meeting. The board will review written comments before its next vote.',
  },
];

app.get('/api/articles', (_request, response) => {
  const articleCards = articles.map(({ sampleText, ...article }) => article);
  response.json({ articles: articleCards });
});

app.use(express.json());

app.post('/api/analyze', (request, response) => {
  const { articleId } = request.body ?? {};
  if (typeof articleId !== 'string') {
    return response.status(400).json({ error: 'Provide an article id to check.' });
  }

  const article = articles.find((item) => item.id === articleId);
  if (!article) {
    return response.status(404).json({ error: 'That sample story was not found.' });
  }

  const loadedWords = ['disastrous', 'shocking', 'outrageous', 'brilliant', 'terrible'];
  const sentences = article.sampleText.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [];
  const signals = sentences.flatMap((sentence) => {
    const matchedWord = loadedWords.find((word) => new RegExp(`\\b${word}\\b`, 'i').test(sentence));
    return matchedWord ? [{
      category: 'Loaded or judgmental wording',
      passage: sentence.trim(),
      explanation: `The word “${matchedWord}” expresses a strong judgment. Check who is using this wording and whether it is attributed.`,
      confidence: 'low',
    }] : [];
  });

  response.json({
    articleId: article.id,
    signals,
    limitations: ['This classroom demo checks a short sample text for a few words only. It does not assess the whole article or decide whether it is biased.'],
  });
});

app.listen(port, () => {
  console.log(`ClearView API is running at http://localhost:${port}`);
});

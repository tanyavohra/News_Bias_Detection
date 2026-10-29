# Evaluating the News Bias Checker

This evaluation harness calls the project's existing Python `/analyze` endpoint, compares its score-based prediction against a human label, and writes a confusion matrix and metrics. It does not replace or train the AI model.

## 1. Prepare a labelled dataset

Copy `articles_template.csv` to `articles.csv`. Add one real article per row:

- `article_id`: unique identifier
- `title`, `text`: headline and article body
- `publisher`, `url`: optional metadata
- `actual_label`: human-assigned `Biased` or `Unbiased`

Use a written rubric consistently. For example, label an article Biased only when there is clear evidence of slanted framing in the supplied article text (e.g. loaded wording, one-sided framing, unsupported generalization), not merely because you disagree with its viewpoint. Label Unbiased when the text does not meet that rubric. Ideally, have two people label independently and resolve disagreements. Record ambiguous cases rather than forcing a label.

Do not use the AI's own prediction to assign the human label. The test labels should be independent of the system being evaluated. Keep articles used to tune the threshold separate from the final test set.

## 2. Install evaluation dependencies

From the repository root:

```bash
python -m pip install -r evaluation/requirements.txt
```

The main application also needs its normal dependencies and a valid `OPENROUTER_API_KEY` in your local `.env`.

## 3. Start the app

In a terminal, from the repository root:

```bash
python -m uvicorn analysis_service.main:app --reload --port 8000
```

Confirm `http://127.0.0.1:8000/health` returns `{"status":"ok"}`.

## 4. Run evaluation

After you have created `evaluation/articles.csv` with labelled article text:

```bash
python evaluation/evaluate.py --input evaluation/articles.csv --threshold 35
```

The threshold is configurable from 0 to 100. The default of 35 is only a provisional project setting because the existing overall score is a severity score, not a calibrated probability. Ideally choose the threshold using a separate development set, freeze it, and only then evaluate a held-out test set. Do not select the threshold to maximize performance on the final test set.

## 5. Read the outputs

Files are written to `evaluation/results/`:

- `confusion_matrix.png`: visual confusion matrix
- `metrics.json`: accuracy, precision, recall, F1, confusion-matrix counts, and evaluation notes
- `predictions.csv`: per-article human label and AI prediction
- `excluded_articles.csv`: validly labelled articles for which the AI returned no score
- `errors.json`: input/API failures, if any

The confusion matrix rows are actual labels and columns are predicted labels, in this order: Unbiased, Biased.

- True negative: human Unbiased, AI Unbiased
- False positive: human Unbiased, AI Biased
- False negative: human Biased, AI Unbiased
- True positive: human Biased, AI Biased

Metrics are calculated only for articles with a valid human label and a non-null AI score. Exclusions and errors are reported rather than silently counted as correct or incorrect.

## Important limitation

This evaluates agreement with the human labelling rubric, not objective truth or universal media bias. The current AI score averages available criterion severity ratings; it is not a probability that an article is biased. Do not report performance numbers until the script has been run on a real, independently labelled dataset. No benchmark results or labels are fabricated by this repository change.

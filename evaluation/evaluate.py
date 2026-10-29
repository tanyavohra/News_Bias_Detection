"""Evaluate ClearView's existing /analyze score against human-labelled articles.

CSV columns required: article_id, title, text, actual_label.
Optional: publisher, url.
actual_label must be Biased or Unbiased.
"""
import argparse
import csv
import json
import os
import sys
import time
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import requests
from sklearn.metrics import (
    accuracy_score,
    classification_report,
    confusion_matrix,
    precision_recall_fscore_support,
    ConfusionMatrixDisplay,
)

LABELS = ["Unbiased", "Biased"]


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", default="evaluation/articles.csv", help="Human-labelled CSV")
    parser.add_argument("--api", default="http://127.0.0.1:8000/analyze", help="Existing analysis endpoint")
    parser.add_argument("--threshold", type=float, default=35, help="Provisional severity-score threshold (0-100); scores >= threshold predict Biased")
    parser.add_argument("--out", default="evaluation/results", help="Output directory")
    parser.add_argument("--delay", type=float, default=0.25, help="Seconds between API requests")
    return parser.parse_args()


def main():
    args = parse_args()
    if not 0 <= args.threshold <= 100:
        sys.exit("--threshold must be between 0 and 100.")

    input_path = Path(args.input)
    if not input_path.exists():
        sys.exit(f"Dataset not found: {input_path}. Copy articles_template.csv to articles.csv and add human labels.")

    with input_path.open("r", encoding="utf-8-sig", newline="") as file:
        rows = list(csv.DictReader(file))

    required = {"article_id", "title", "text", "actual_label"}
    if not rows or not required.issubset(rows[0].keys()):
        sys.exit("CSV must have columns: article_id,title,text,actual_label (publisher and url are optional).")

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    evaluated, excluded, errors = [], [], []

    for index, row in enumerate(rows, start=1):
        label = (row.get("actual_label") or "").strip().capitalize()
        if label not in LABELS:
            errors.append({"article_id": row.get("article_id", ""), "error": f"Invalid actual_label '{label}'. Use Biased or Unbiased."})
            continue
        if not (row.get("text") or "").strip():
            errors.append({"article_id": row.get("article_id", ""), "error": "Missing article text."})
            continue

        payload = {
            "article_id": (row.get("article_id") or str(index)).strip(),
            "title": row.get("title") or "",
            "text": row["text"],
            "publisher": row.get("publisher") or "",
            "url": row.get("url") or "",
            "assessment_basis": "full_article",
        }
        try:
            response = requests.post(args.api, json=payload, timeout=120)
            response.raise_for_status()
            result = response.json()
        except (requests.RequestException, ValueError) as exc:
            errors.append({"article_id": payload["article_id"], "error": str(exc)})
            continue

        score = result.get("overallScore")
        record = {
            "article_id": payload["article_id"],
            "actual_label": label,
            "overall_score": score,
            "threshold": args.threshold,
            "predicted_label": "",
            "assessed_criteria": result.get("assessedCount"),
            "flagged_sentence_count": result.get("flaggedSentenceCount"),
        }
        if score is None:
            excluded.append({**record, "reason": "AI returned no overall score"})
        else:
            record["predicted_label"] = "Biased" if float(score) >= args.threshold else "Unbiased"
            evaluated.append(record)
        print(f"[{index}/{len(rows)}] {payload['article_id']}: score={score}, actual={label}")
        if args.delay:
            time.sleep(args.delay)

    predictions_path = out_dir / "predictions.csv"
    output_columns = ["article_id", "actual_label", "overall_score", "threshold", "predicted_label", "assessed_criteria", "flagged_sentence_count"]
    with predictions_path.open("w", encoding="utf-8", newline="") as file:
        writer = csv.DictWriter(file, fieldnames=output_columns)
        writer.writeheader()
        writer.writerows(evaluated)

    with (out_dir / "excluded_articles.csv").open("w", encoding="utf-8", newline="") as file:
        columns = ["article_id", "actual_label", "overall_score", "threshold", "predicted_label", "assessed_criteria", "flagged_sentence_count", "reason"]
        writer = csv.DictWriter(file, fieldnames=columns)
        writer.writeheader()
        writer.writerows(excluded)

    metrics = {
        "evaluation_count": len(evaluated),
        "excluded_count": len(excluded),
        "input_row_count": len(rows),
        "error_count": len(errors),
        "threshold": args.threshold,
        "positive_class": "Biased",
        "threshold_note": "35 is a provisional project setting, not a scientifically validated cutoff. Choose it on a separate development set, then freeze it before final testing.",
        "label_note": "Metrics measure agreement with the supplied human labels, not objective or universal truth about media bias.",
        "errors": errors,
    }

    if evaluated:
        y_true = [item["actual_label"] for item in evaluated]
        y_pred = [item["predicted_label"] for item in evaluated]
        cm = confusion_matrix(y_true, y_pred, labels=LABELS)
        precision, recall, f1, _ = precision_recall_fscore_support(
            y_true, y_pred, labels=["Biased"], average="binary", pos_label="Biased", zero_division=0
        )
        metrics.update({
            "accuracy": round(float(accuracy_score(y_true, y_pred)), 4),
            "precision_biased": round(float(precision), 4),
            "recall_biased": round(float(recall), 4),
            "f1_biased": round(float(f1), 4),
            "confusion_matrix_labels_order": LABELS,
            "confusion_matrix": {
                "true_unbiased_pred_unbiased": int(cm[0, 0]),
                "true_unbiased_pred_biased": int(cm[0, 1]),
                "true_biased_pred_unbiased": int(cm[1, 0]),
                "true_biased_pred_biased": int(cm[1, 1]),
            },
            "classification_report": classification_report(
                y_true, y_pred, labels=LABELS, output_dict=True, zero_division=0
            ),
        })
        display = ConfusionMatrixDisplay(confusion_matrix=cm, display_labels=LABELS)
        display.plot(values_format="d", cmap="Blues", colorbar=False)
        plt.title(f"News Bias Checker (score threshold: {args.threshold:g})")
        plt.tight_layout()
        plt.savefig(out_dir / "confusion_matrix.png", dpi=160)
        plt.close()
    else:
        metrics["note"] = "No articles had both a valid human label and an AI score. No metrics were calculated."

    if errors:
        (out_dir / "errors.json").write_text(json.dumps(errors, indent=2), encoding="utf-8")
    (out_dir / "metrics.json").write_text(json.dumps(metrics, indent=2), encoding="utf-8")
    print("\nEvaluation finished.")
    print(f"Scored: {len(evaluated)} | Excluded (no score): {len(excluded)} | Input errors: {len(errors)}")
    if evaluated:
        print(f"Accuracy: {metrics['accuracy']:.1%} | Precision: {metrics['precision_biased']:.1%} | Recall: {metrics['recall_biased']:.1%} | F1: {metrics['f1_biased']:.1%}")
    print(f"Results saved to: {out_dir.resolve()}")


if __name__ == "__main__":
    main()

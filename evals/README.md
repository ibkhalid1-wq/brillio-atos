# ADAM evals

Evaluation harnesses for ADAM agent output quality live under [`src/lib/evals`](../src/lib/evals).

Run them with:

```bash
npm run evals
```

Each eval run loads the current prompt registry version for an agent, executes the packaged dataset and judge flow, and reports score/regression summaries for prompt changes.

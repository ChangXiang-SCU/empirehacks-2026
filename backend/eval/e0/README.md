# E0: which level of memory answers which kind of question

Mnemosyne keeps raw turns (D) and distils them into facts (I), know-how (K) and principles (W), plus exact records
(to-dos, decisions, facts with expiry). Published comparisons often find that raw text with good retrieval matches or
beats distilled memory on recall questions. E0 checks, on your own memory, whether the distilled levels earn their keep
for any kind of question, at an equal context budget. If they do not, the levels are not a selling point.

## Levels and question types

| Level | What it is |
|---|---|
| D | raw conversation turns |
| I / K / W | distilled or recorded entries of that type |
| R | exact records: entries tagged todo, decision or fact |
| M | imported Project material and notes (not distilled from sessions; only in `everything-*`) |

| Type | Example | Levels the router sends it to (the hypothesis under test) |
|---|---|---|
| fact | What port does the admin console use? | D, I |
| update | Which model does distillation use now? | I, D |
| multi | What did we try for the proxy problem? | I, K |
| howto | How did we deploy the service? | K, D |
| decision | Should I change this in production directly? | W, K |
| record | What is still open for the paper? | R |

## Conditions

`prod-keyword` (the scorer `search_memory` uses today), `D-bm25`, `D-dense`, `D-hybrid`, one condition per level
(`I-`, `K-`, `W-`, `R-`), `IKW-`, `DIKW-`, `everything-`, `routed-oracle-` (levels chosen from the labelled type) and
`routed-guess-` (levels chosen by a keyword guess). Hybrid is BM25 and embeddings fused with reciprocal rank fusion.
Without an embedding endpoint the dense conditions are dropped and the rest run on BM25 alone.

## Steps

1. Run the server with query logging (on by default). Every `search_memory`, `get_project_context` and `get_node`
   call is appended to `query-log.jsonl` next to the database (`MNEMO_QUERY_LOG=off` disables it, or set a path).
2. Copy the database file and the log from the server to this machine.
3. Draft the question file from the real queries:
   `node eval/e0/draft-questions.mjs --log query-log.jsonl --db mnemosyne.db`
4. Label `eval/e0/questions.json`: for each draft set `type`, the `answer`, `nuggets` (short strings a context must
   contain to answer; prefix `re:` for a regular expression) and `evidence` (ids of entries that hold the answer;
   entries opened right after the query are pre-filled). Drafts without a type are skipped. Aim for 150 to 200
   questions with at least 20 per type. Keep `asOf`: the run then only sees memory that existed when the question
   was asked.
5. Run:
   `node eval/e0/run.mjs --db mnemosyne.db --questions eval/e0/questions.json`
   - embeddings: set `MNEMO_EMBED_BASE_URL` and `MNEMO_EMBED_MODEL` (any OpenAI-compatible `/embeddings` endpoint;
     a multilingual model such as bge-m3 suits mixed Chinese and English). Vectors are cached in `eval/e0/.cache`.
   - `--answer` also has an LLM answer from each context and grades it against `answer` (uses the `MNEMO_LLM_*`
     settings of `lib/dikwEngine.js`; answers are cached in the output folder, so a rerun resumes).
   - `--budget 1500` context tokens, `--k 10`, `--out <dir>`.
6. Read `eval/e0/results/summary.md`. The last section lists every condition whose nugget recall is above the D-only
   baseline with a 95% bootstrap interval that excludes zero.

## Reading the numbers

- **nuggets** is the main automatic measure: the share of answer nuggets present in the context built from the top
  results within the token budget. It is lexical, so check a sample by hand.
- **hit@k / MRR** use the gold evidence plus entries distilled from it (following the D to I to K to W links). An entry
  can be linked to the evidence and still have lost the answer, which is why nuggets and accuracy matter more.
- **stale share** is the share of context entries that are superseded, expired or done records.
- **accuracy** (with `--answer`) is the share of answers graded correct; grade a sample by hand before trusting it.
- Token counts are an estimate (one per CJK character, one per four other characters), the same for all conditions.

Known limits: evidence is judged per entry, not per passage; links from raw turns to distilled entries are incomplete
for sessions that were re-ingested; the keyword router is a deliberately simple baseline.

## Privacy

`questions.json`, `results/`, `.cache/` and `query-log.jsonl` contain personal data and are git-ignored. Do not commit
them. `questions.example.json` shows the format with made-up content.

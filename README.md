# Round Tracker

Static fruit-round tracker with Supabase authentication, shared round history,
descriptive statistics, prospective accuracy tracking and experimental generator
matching. This repository is not the crypto trading bot.

## Running and testing

Serve this directory over HTTP(S); opening `index.html` with `file://` does not
reliably support workers. GitHub Pages can serve these files without a build.
Deploy `index.html`, `prediction-core.js`, `data-client.js` and `rng-worker.js`
together. Hard-refresh after an update.

Run `node --test tests/*.test.js` (Node 20+) or `npm test`. There are no package
dependencies. GitHub Actions runs this suite on pushes and pull requests.

## Prediction method

- Only the latest consecutive run of recorded round numbers feeds sequence
  models. Missing rounds break the sequence; they are never silently joined.
- The frequency baseline uses observed counts with 40 pseudo-observations from
  the normalized legacy reference rates. Those rates are assumed observations,
  not verified probabilities supplied by the game.
- The candidate pattern model mixes first-, second- and third-order transitions
  with weights 0.5/0.3/0.2 and eight pseudo-observations from the frequency
  baseline. Smoothing prevents a single matching pattern implying 100% certainty.
- Walk-forward evaluation starts after 20 observations. Each outcome is scored
  before it enters training. The model-switching decision also uses only earlier
  outcomes. Both policy accuracy and log loss are compared on the same rounds.
- The pattern candidate is eligible only after 100 test outcomes, higher hit
  count than baseline, mean log-loss improvement exceeding both 0.01 and two
  estimated standard errors, and positive loss improvement in both chronological
  halves. This is a conservative **heuristic gate**, not a calibrated significance
  test: overlapping contexts, repeated inspection and nonstationarity limit it.
- Without that evidence, the banner says **No validated pattern edge**, shows
  the frequency estimate for reference, and abstains from a pattern pick.
  Historical advantage still needs confirmation with new prospective outcomes.
- Long absences and streaks remain descriptive. They never boost probabilities.
  Estimates and hit rate do not measure profitability or account for payouts.

The live accuracy ledger is versioned and scoped to the signed-in account and
browser. It saves today's chronological next-round forecast before observation,
grades it once on entry or refresh, and compares each method with the frequency
baseline on its own eligible rounds. Historical-date backfill is not scored.
Editing/deleting history invalidates affected scores; refreshing also reconciles
changes made elsewhere. Up to 400 recent forecasts are retained. Old scores are
not imported because their model definitions and scoring were different.

## RNG experiments

Generator fitting runs in a cancellable Web Worker. Integer operations use exact
low-bit multiplication for power-of-two LCGs, unsigned xorshift32 shifts, and a
tested maximal-period LFSR shift convention. Output bucket weights are normalized
consistently with the stated reference distribution.

Each experiment uses at most the last 80 consecutive outcomes, with the last 20
held out from seed fitting. At least 40 consecutive outcomes are required. A
candidate state is fitted to the earlier window only; its continuation advances
from that same window, regardless of the full day's length. The display reports
training matches, holdout matches, states searched and a train-chosen frequency
baseline on the identical holdout.

The search covers positive states 1–100,000 for each LCG/xorshift (limited by the
generator modulus), and all nonzero states for the three small LFSRs. It does not
search every possible state of a 32-bit generator. It assumes one generator step
per recorded outcome, an unknown state at the window start, a particular bucket
mapping, and no reseeding. Actual game weights and RNG internals are unknown.

Searching many states can fit chance patterns. Results across nine generator
families are exploratory; the best holdout result is not automatically selected
as a proven predictor. Only a candidate matching the entire training and holdout
window exposes an explicitly unverified continuation. Even an exact match is
not proof of recovering the game's algorithm or seed. No match means these
assumptions/search ranges did not recover one; it does not prove randomness.

## Data reliability and deployment requirements

Round loads paginate instead of assuming a large requested limit bypasses the
server cap. Requests have deadlines and retry authentication once after a 401.
Mutations are not automatically retried after ambiguous network failures. Load
versions prevent stale date responses or post-logout requests from replacing
current state. Writes are serialized; no-op responses and invalid/duplicate
round data produce errors rather than false success.

The existing Supabase URL and publishable key are retained. A publishable key is
intended for a client; authorization must be enforced by the database. The
administrator email list controls the UI only.

Before production use, verify the existing database has:

- RLS policies restricting inserts, updates and deletes to authorized editors,
  with appropriate authenticated read access.
- A unique constraint on `(play_date, round_number)`, so two browser sessions
  cannot create duplicate rounds.
- Round-number and outcome constraints consistent with rounds 1–2600 and
  `T K O L C S G W` (plus any intentionally supported blank placeholder).

These database settings cannot be verified or changed from repository files.
Pagination is not a transactional snapshot: concurrent external edits can
require another refresh. No live Supabase records were used or modified for
the regression suite, and no real-game predictive performance is claimed.

References: [Supabase select and pagination](https://supabase.com/docs/reference/javascript/select),
[Supabase row-level security](https://supabase.com/docs/guides/database/postgres/row-level-security),
[scikit-learn guidance on data leakage](https://scikit-learn.org/stable/common_pitfalls.html#data-leakage).

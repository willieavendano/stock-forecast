# Stock Forecast

> **Teaching exemplar.** Built by the author, working with AI co-authoring agents, as an exemplar for a secondary-school research course. No student contributed to this code. Catalogued by Null Design as ND-006.

A stock price forecasting app built with React. All models train and run **in the browser**. The only server code is one small function that relays daily price history.

**Live:** https://stock-forecast-hazel.vercel.app

## Models

| Model | Description |
|-------|-------------|
| **LSTM** | TensorFlow.js two-layer LSTM (64 units each) with dropout and early stopping, trained on a configurable lookback window of daily log returns |
| **GBM** | Geometric Brownian Motion — fits drift (µ) and volatility (σ) from historical log returns, then runs Monte Carlo simulations to produce median forecasts and 5–95% confidence bands. Scored with train-split parameters; the charted forecast refits on the full history |
| **Decision Tree** | CART-style regressor that predicts the next day's log return, with grid-searched hyperparameters (depth, min samples, max features) evaluated on a hold-out validation set; uses 9 engineered technical features (RSI, MACD, rolling stats, etc.), all relative rather than price levels |
| **Ensemble** | Equal-weight average of all selected models, with confidence bands widened by cross-model disagreement |

## Metrics

After training, each model (including the Ensemble) is scored on a held-out test set with a walk-forward test: every test-set day is predicted twice, once from 1 trading day earlier and once from 30 trading days earlier (the horizon the chart forecasts). Both are reported as:

- **MAE** — Mean Absolute Error
- **RMSE** — Root Mean Squared Error
- **MAPE** — Mean Absolute Percentage Error (%)

A **Naive** baseline — the last known price carried forward unchanged — is scored the same way and shown as its own row. A model adds information only where its error is lower than that row.

## Data

Daily prices load without an API key through `/api/prices`, a server function in [`api/prices.js`](api/prices.js). The price sources do not allow requests from a browser, so the function fetches them server-side and returns one normalised series. It tries, in order:

- **Yahoo Finance** — dividend- and split-adjusted closes
- **NASDAQ** — used when Yahoo has no answer; closes are not dividend-adjusted

The activity log shows which source supplied the data. Only the ticker and date range are sent to the server; training and forecasting stay in the browser.

Optionally, enter a free **Alpha Vantage** API key to fetch directly from the browser instead. On a static host with no server function, the app falls back to public CORS proxies, which are unreliable.

Data is split into train / validation / test (80 / 10 / 10) with no look-ahead bias.

The LSTM and Decision Tree model **returns, not prices**. A model fitted on price levels cannot follow a stock that has moved outside the range it was trained on; predicted returns are compounded forward from the last known price instead.

## Tech Stack

- [React 18](https://react.dev/)
- [TensorFlow.js](https://www.tensorflow.org/js) — in-browser LSTM training and inference
- [Recharts](https://recharts.org/) — forecast chart
- [Vite](https://vitejs.dev/) — bundler

## Local Development

```bash
npm install
npm run dev
```

Then open [http://localhost:5173](http://localhost:5173).

`npm run dev` serves the front end only. To run the `/api/prices` function locally as well, use `npx vercel dev`.

## Build

```bash
npm run build   # outputs to /build
npm run preview # preview the production build
```

The build uses relative asset paths (`base: "./"`), so it works at a domain root or under a sub-path.

## Deployment

The app is hosted on [Vercel](https://vercel.com) (project `stock-forecast`), configured by [`vercel.json`](vercel.json): Vercel builds the Vite app into `/build` and deploys `api/prices.js` as a function.

```bash
npx vercel          # preview deployment
npx vercel --prod   # production
```

A GitHub Pages copy is still published from `main` by `.github/workflows/deploy-pages.yml`. Pages is a static host, so that copy has no `/api/prices` and needs an Alpha Vantage key to load data.

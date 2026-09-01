# Stock Forecast

> **Teaching exemplar.** Built by the author, working with AI co-authoring agents, as an exemplar for a secondary-school research course. No student contributed to this code. Catalogued by Null Design as ND-006.

A client-side stock price forecasting app built with React. All models run **100% in the browser** — no backend server, no data leaves your machine.

## Models

| Model | Description |
|-------|-------------|
| **LSTM** | TensorFlow.js two-layer LSTM (64 units each) with dropout and early stopping, trained on a configurable lookback window |
| **GBM** | Geometric Brownian Motion — fits drift (µ) and volatility (σ) from historical log returns, then runs Monte Carlo simulations to produce median forecasts and 5–95% confidence bands |
| **Decision Tree** | CART-style regressor with grid-searched hyperparameters (depth, min samples, max features) evaluated on a hold-out validation set; uses 9 engineered technical features (RSI, MACD, rolling stats, etc.) |
| **Ensemble** | Equal-weight average of all selected models, with confidence bands widened by cross-model disagreement |

## Metrics

After training, each model (including the Ensemble) is evaluated on a held-out test set and reported as:

- **MAE** — Mean Absolute Error
- **RMSE** — Root Mean Squared Error
- **MAPE** — Mean Absolute Percentage Error (%)

## Data

Stock data is fetched client-side via:

- **Alpha Vantage** (recommended) — provide a free API key for reliable, CORS-enabled data
- **Yahoo Finance** via CORS proxies — fallback, no API key required (may be rate-limited)

Data is split into train / validation / test (80 / 10 / 10) with no look-ahead bias.

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

## Build

```bash
npm run build   # outputs to /build
npm run preview # preview the production build
```

The build uses relative asset paths (`base: "./"`) so it deploys cleanly to GitHub Pages or any static host.

## Deployment

The app is configured for GitHub Pages. Push the `/build` directory contents to the `gh-pages` branch (or configure Pages to serve from `/build` on `main`).

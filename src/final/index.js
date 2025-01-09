import express from "express";
import yahooFinance from "yahoo-finance2";
import cors from "cors";
import fetch from "node-fetch";
import axios from "axios";
import { OpenAI } from "openai";
import dotenv from "dotenv";

dotenv.config();

const app = express.Router();
const port = process.env.PORT || 4000;

app.use(express.json());
app.use(cors());

const openai = new OpenAI({
  apiKey: process.env.API_KEY,
});

const formatLargeNumber = (num) => {
  if (num >= 1e12) return (num / 1e12).toFixed(2) + "T";
  if (num >= 1e9) return (num / 1e9).toFixed(2) + "B";
  if (num >= 1e6) return (num / 1e6).toFixed(2) + "M";
  return num?.toString() || "N/A";
};

app.get("/api/stock/:ticker", async (req, res) => {
  const { ticker } = req.params;

  if (!ticker) {
    return res.status(400).json({ error: "Invalid ticker" });
  }

  try {
    const quote = await yahooFinance.quote(ticker);
    const financialData = await yahooFinance.quoteSummary(ticker, {
      modules: ["financialData", "defaultKeyStatistics", "recommendationTrend"],
    });

    const stockData = {
      name: quote.longName || "N/A",
      description: quote.longBusinessSummary || "N/A",
      marketCap: formatLargeNumber(quote.marketCap),
      sharesOutstanding: formatLargeNumber(quote.sharesOutstanding),
      float: formatLargeNumber(financialData.defaultKeyStatistics.floatShares),
      evEbitda:
        financialData.defaultKeyStatistics.enterpriseToEbitda?.toFixed(2) ||
        "N/A",
      peTtm: quote.trailingPE?.toFixed(2) || "N/A",
      dividendRate: quote.dividendRate?.toFixed(2) || "N/A",
      cashPosition: formatLargeNumber(financialData.financialData.totalCash),
      totalDebt: formatLargeNumber(financialData.financialData.totalDebt),
      debtToEquity:
        financialData.financialData.debtToEquity?.toFixed(2) || "N/A",
      currentRatio:
        financialData.financialData.currentRatio?.toFixed(2) || "N/A",
      strengthsAndCatalysts: "Requires manual input or additional API",
      analystRating:
        financialData.financialData.recommendationMean?.toFixed(2) || "N/A",
      numberOfAnalysts:
        financialData.financialData.numberOfAnalystOpinions?.toString() ||
        "N/A",
      meanTargetPrice:
        financialData.financialData.targetMeanPrice?.toFixed(2) || "N/A",
      impliedChange:
        (
          (financialData.financialData.targetMeanPrice /
            quote.regularMarketPrice -
            1) *
          100
        )?.toFixed(2) + "%" || "N/A",
      risksAndMitigation: "Requires manual input or additional API",
      recommendation:
        financialData.recommendationTrend.trend[0]?.strongBuy >
        financialData.recommendationTrend.trend[0]?.sell
          ? "Buy"
          : "Sell",
    };

    res.json(stockData);
  } catch (error) {
    console.error("Error fetching stock data:", error);
    res.status(500).json({ error: "Failed to fetch stock data" });
  }
});

app.post("/generate-image", async (req, res) => {
  const { stockName } = req.body;

  if (!stockName) {
    return res.status(400).json({ error: "Stock name is required" });
  }

  const prompt = `${stockName} logo with futuristic city, blue and purple color, neon glow, detailed, high quality. Modern,high tech,soft,bold aesthetic,using dark shades of purple, blue, and black in a gradient`;

  try {
    const generateResponse = await axios.post(
      "https://api.bfl.ml/v1/flux-pro-1.1",
      {
        prompt: prompt,
        width: 896,
        height: 1152,
      },
      {
        headers: {
          accept: "application/json",
          "x-key": process.env.BFL_API_KEY,
          "Content-Type": "application/json",
        },
      }
    );

    const requestId = generateResponse.data.id;

    if (!requestId) {
      return res
        .status(500)
        .json({ error: "No request ID received from BFL API" });
    }

    console.log("Image generation started, waiting for the result...");

    let imageUrl = null;
    let status = "Processing";

    while (status !== "Ready") {
      await new Promise((resolve) => setTimeout(resolve, 500));
      const resultResponse = await axios.get(
        `https://api.bfl.ml/v1/get_result?id=${requestId}`,
        {
          headers: {
            accept: "application/json",
            "x-key": process.env.BFL_API_KEY,
          },
        }
      );

      status = resultResponse.data.status;
      if (status === "Ready") {
        imageUrl = resultResponse.data.result.sample;
        console.log("Image ready!");
      } else {
        console.log(`Status: ${status}`);
      }
    }

    if (imageUrl) {
      res.status(200).json({ imageUrl });
    } else {
      res.status(500).json({ error: "Failed to retrieve the image URL" });
    }
  } catch (error) {
    console.error(
      "Error generating or fetching image:",
      error.response?.data || error.message
    );
    res.status(500).json({ error: "Failed to generate or retrieve image" });
  }
});

app.post("/api/gpt", async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) {
    return res.status(400).send({ error: "Prompt is required" });
  }

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [{ role: "user", content: prompt }],
    });

    res.send({ response: response.choices[0].message.content });
  } catch (error) {
    console.error("Error:", error);
    res.status(500).send({ error: "Failed to get GPT response" });
  }
});

app.post("/api/get-ticker", async (req, res) => {
  const { stockName } = req.body;

  if (!stockName) {
    return res.status(400).send({ error: "Stock name is required" });
  }

  try {
    const searchResults = await yahooFinance.search(stockName);

    if (searchResults && searchResults.quotes.length > 0) {
      const ticker = searchResults.quotes[0].symbol;
      return res.send({ ticker });
    } else {
      return res.status(404).send({ error: "Stock not found" });
    }
  } catch (error) {
    console.error(error);
    return res
      .status(500)
      .send({ error: "Failed to fetch stock data from Yahoo Finance" });
  }
});

app.listen(port, () => {
  console.log(`Merged Finance API server running at http://localhost:${port}`);
});

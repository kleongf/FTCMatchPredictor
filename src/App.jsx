import React, { useState } from "react";
import { jStat } from "jstat";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

// Request headers
const headers = {
  "User-Agent": "Mozilla/5.0",
  "Accept-Encoding": "gzip, deflate, br",
};

// Fetch list of events with stats
async function getEventCodes(teamNumber) {
  const response = await fetch(
    `https://api.ftcscout.org/rest/v1/teams/${teamNumber}/events/2024`,
    { headers }
  );
  const data = await response.json();
  return data
    .filter((entry) => entry.stats != null)
    .map((entry) => entry.eventCode);
}

// Fetch matches for a team at a specific event
async function getMatches(eventCode, teamNumber) {
  const response = await fetch(
    `https://api.ftcscout.org/rest/v1/events/2024/${eventCode}/matches`,
    { headers }
  );
  const data = await response.json();
  const results = {
    autoSpecimen: [],
    autoSample: [],
    dcSpecimen: [],
    dcSample: [],
  };

  for (const match of data) {
    const teamEntry = (match.teams || []).find(
      (t) => t.teamNumber === teamNumber
    );
    if (!teamEntry) continue;
    const color = teamEntry.alliance.toLowerCase();
    const score = match.scores?.[color];
    if (score) {
      results.autoSpecimen.push(score.autoSpecimenPoints);
      results.autoSample.push(score.autoSamplePoints);
      results.dcSpecimen.push(score.dcSpecimenPoints);
      results.dcSample.push(score.dcSamplePoints);
    }
  }

  return results;
}

function addArrays(a, b) {
  return a.map((v, i) => v + (b[i] || 0));
}

function addScalar(arr, scalar) {
  return arr.map((v) => v + scalar);
}

async function getAllScores(team, auto, tele, endgame) {
  let allScores = [];
  const events = await getEventCodes(team);
  for (const event of events) {
    const match = await getMatches(event, team);
    let total = auto === "s" ? match.autoSample : match.autoSpecimen;
    total =
      tele === "s"
        ? addArrays(total, match.dcSample)
        : addArrays(total, match.dcSpecimen);
    total = addScalar(total, endgame);
    allScores = allScores.concat(total);
  }
  return allScores;
}

function allianceWinProbability(
  mu1,
  sigma1,
  mu2,
  sigma2,
  mu3,
  sigma3,
  mu4,
  sigma4
) {
  const muA = mu1 + mu2,
    varA = sigma1 ** 2 + sigma2 ** 2;
  const muB = mu3 + mu4,
    varB = sigma3 ** 2 + sigma4 ** 2;
  const muD = muA - muB,
    sigmaD = Math.sqrt(varA + varB);
  return jStat.normal.cdf(muD / sigmaD, 0, 1);
}

// Generate distribution curve for plotting
function generateNormalData(mean, std, label) {
  const data = [];
  const min = mean - 3 * std;
  const max = mean + 3 * std;
  const step = (max - min) / 50;

  for (let x = min; x <= max; x += step) {
    const y = jStat.normal.pdf(x, mean, std);
    data.push({ x: parseFloat(x.toFixed(2)), y, label });
  }

  return data;
}

export default function App() {
  const [teams, setTeams] = useState([
    { label: "Red Team 1", number: "", auto: "S", tele: "S", end: 30 },
    { label: "Red Team 2", number: "", auto: "s", tele: "s", end: 30 },
    { label: "Blue Team 1", number: "", auto: "S", tele: "S", end: 30 },
    { label: "Blue Team 2", number: "", auto: "s", tele: "s", end: 30 },
  ]);
  const [result, setResult] = useState(null);
  const [chartData, setChartData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const update = (i, field, value) => {
    const next = [...teams];
    if (field === "number" || field === "end") {
      next[i][field] = value === "" ? "" : value.replace(/\D/, "");
    } else {
      next[i][field] = value;
    }
    setTeams(next);
  };

  const calculate = async () => {
    setError(null);
    setResult(null);
    setChartData([]);

    // Validate inputs
    for (const t of teams) {
      if (t.number === "" || isNaN(parseInt(t.number))) {
        setError("Please enter a valid team number for all teams.");
        return;
      }
      if (t.end === "" || isNaN(parseInt(t.end))) {
        setError("Please enter valid endgame points for all teams.");
        return;
      }
    }

    setLoading(true);

    try {
      const scores = await Promise.all(
        teams.map((t) =>
          getAllScores(
            parseInt(t.number),
            t.auto,
            t.tele,
            parseInt(t.end)
          )
        )
      );

      const stats = scores.map((s) => [
        jStat.mean(s),
        jStat.stdev(s, true),
      ]);

      const winProb = allianceWinProbability(
        stats[0][0],
        stats[0][1],
        stats[1][0],
        stats[1][1],
        stats[2][0],
        stats[2][1],
        stats[3][0],
        stats[3][1]
      );

      setResult(
        `🔴 Red Alliance win probability: ${(winProb * 100).toFixed(2)}%`
      );

      const redData = generateNormalData(
        stats[0][0] + stats[1][0],
        Math.sqrt(stats[0][1] ** 2 + stats[1][1] ** 2),
        "Red Alliance"
      );
      const blueData = generateNormalData(
        stats[2][0] + stats[3][0],
        Math.sqrt(stats[2][1] ** 2 + stats[3][1] ** 2),
        "Blue Alliance"
      );

      setChartData([...redData, ...blueData]);
    } catch (e) {
      console.error(e);
      setError("❌ Error computing probability.");
    }

    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white p-8">
      <h1 className="text-3xl font-bold mb-6 text-center">
        FTC Alliance Win Predictor
      </h1>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Left Panel */}
        <div className="md:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-4">
          {teams.map((team, i) => (
            <div key={i} className="bg-gray-800 p-4 rounded-xl shadow-md">
              <h2 className="text-xl font-semibold mb-2">{team.label}</h2>
              <input
                className="w-full mb-2 p-2 rounded bg-gray-700"
                placeholder="Team Number"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={team.number}
                onChange={(e) => update(i, "number", e.target.value)}
              />
              <label className="block mb-1">Autonomous:</label>
              <select
                className="w-full mb-2 p-2 rounded bg-gray-700"
                value={team.auto}
                onChange={(e) => update(i, "auto", e.target.value)}
              >
                <option value="S">Specimen (S)</option>
                <option value="s">Sample (s)</option>
              </select>
              <label className="block mb-1">Teleop:</label>
              <select
                className="w-full mb-2 p-2 rounded bg-gray-700"
                value={team.tele}
                onChange={(e) => update(i, "tele", e.target.value)}
              >
                <option value="S">Specimen (S)</option>
                <option value="s">Sample (s)</option>
              </select>
              <label className="block mb-1">Endgame Points:</label>
              <input
                className="w-full mb-2 p-2 rounded bg-gray-700"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={team.end}
                onChange={(e) => update(i, "end", e.target.value)}
              />
            </div>
          ))}
        </div>

        {/* Right Panel */}
        <div className="bg-gray-800 p-6 rounded-xl flex flex-col justify-between shadow-lg">
          <div>
            <h2 className="text-xl font-bold mb-4">Prediction</h2>
            {error && <p className="text-red-500 mb-4">{error}</p>}
            {result ? (
              <p className="text-2xl text-green-400 mb-4">{result}</p>
            ) : (
              <p className="text-gray-400 mb-4">
                Fill out team info and click calculate.
              </p>
            )}
          </div>

          <button
            onClick={calculate}
            className="mt-2 px-4 py-3 bg-blue-500 hover:bg-blue-600 text-white font-bold rounded-xl"
            disabled={loading}
          >
            {loading ? "Calculating..." : "Calculate Win Probability"}
          </button>

          {chartData.length > 0 && (
            <div className="mt-6 h-64 bg-gray-900 rounded p-2">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    type="number"
                    dataKey="x"
                    domain={["auto", "auto"]}
                    label={{ value: "Score", position: "insideBottom", dy: 10 }}
                  />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Line
                    data={chartData.filter((d) => d.label === "Red Alliance")}
                    dataKey="y"
                    name="Red Alliance"
                    stroke="#f87171"
                    dot={false}
                  />
                  <Line
                    data={chartData.filter((d) => d.label === "Blue Alliance")}
                    dataKey="y"
                    name="Blue Alliance"
                    stroke="#60a5fa"
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}





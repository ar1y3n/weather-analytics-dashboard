// src/App.jsx
import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import axios from "axios";
import { Provider, useSelector, useDispatch } from "react-redux";
import { configureStore, createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
  AreaChart,
  Area,
} from "recharts";

// --------------------------------------------------
// Config
// --------------------------------------------------
/*const OWM_KEY = process.env.REACT_APP_OWM_KEY || "REPLACE_WITH_YOUR_KEY";
const GEO_CODING_URL = "https://api.openweathermap.org/geo/1.0/direct";
const ONECALL_URL = "https://api.openweathermap.org/data/2.5/onecall";*/
const GEO_CODING_URL = "https://geocoding-api.open-meteo.com/v1/search";
const WEATHER_URL = "https://api.open-meteo.com/v1/forecast";

// --------------------------------------------------
// Simple caching layer (in-memory + localStorage fallback)
// Cache TTL default: 60 seconds
// --------------------------------------------------
const CACHE_PREFIX = "wad_cache_v1_";
function cacheSet(key, data) {
  const payload = { ts: Date.now(), data };
  try {
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(payload));
  } catch (e) {}
}
function cacheGet(key, ttl = 60_000) {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    const { ts, data } = JSON.parse(raw);
    if (Date.now() - ts < ttl) return data;
    return null;
  } catch (e) {
    return null;
  }
}

// --------------------------------------------------
// Redux slices
// --------------------------------------------------

// Async thunk to fetch weather via OneCall (current, hourly, daily)
/*export const fetchWeatherFor = createAsyncThunk(
  "weather/fetchFor",
  async ({ lat, lon, units = "metric", name }, { rejectWithValue }) => {
    try {
      const cacheKey = `onecall_${lat}_${lon}_${units}`;
      const cached = cacheGet(cacheKey, 60_000);
      if (cached) return { ...cached, cached: true, lat, lon, units, name };

      const res = await axios.get(ONECALL_URL, {
        params: { lat, lon, units, appid: OWM_KEY, exclude: "minutely,alerts" },
      });
      cacheSet(cacheKey, res.data);
      // return lat/lon so reducers can key by them
      return { ...res.data, cached: false, lat, lon, units, name };
    } catch (err) {
      return rejectWithValue(err.response?.data || err.message);
    }
  }
);*/
export const fetchWeatherFor = createAsyncThunk(
  "weather/fetchFor",
  async ({ lat, lon, units = "metric", name }, { rejectWithValue }) => {
    try {
      const cacheKey = `om_${lat}_${lon}_${units}`;
      const cached = cacheGet(cacheKey, 60_000);
      if (cached) return { ...cached, cached: true, lat, lon, units, name };

      const isMetric = units === "metric";
      const res = await axios.get(WEATHER_URL, {
        params: {
          latitude: lat,
          longitude: lon,
          current: ["temperature_2m", "relative_humidity_2m", "pressure_msl", "wind_speed_10m"],
          hourly: ["temperature_2m", "precipitation_probability", "wind_speed_10m"],
          daily: ["temperature_2m_max", "temperature_2m_min", "precipitation_probability_max"],
          timezone: "auto",
        },
      });

      const mapped = {
        lat,
        lon,
        name,
        units,
        current: {
          temp: res.data.current.temperature_2m,
          humidity: res.data.current.relative_humidity_2m,
          pressure: res.data.current.pressure_msl,
          wind_speed: res.data.current.wind_speed_10m,
          weather: [{ description: "Clear or cloudy (data simplified)", icon: "01d" }],
          dt: Date.now() / 1000,
        },
        hourly: res.data.hourly.time.map((t, i) => ({
          dt: new Date(t).getTime() / 1000,
          temp: res.data.hourly.temperature_2m[i],
          pop: (res.data.hourly.precipitation_probability?.[i] || 0) / 100,
          wind_speed: res.data.hourly.wind_speed_10m[i],
        })),
        daily: res.data.daily.time.map((t, i) => ({
          dt: new Date(t).getTime() / 1000,
          temp: {
            min: res.data.daily.temperature_2m_min[i],
            max: res.data.daily.temperature_2m_max[i],
          },
          pop: (res.data.daily.precipitation_probability_max?.[i] || 0) / 100,
        })),
        timezone: res.data.timezone,
      };

      cacheSet(cacheKey, mapped);
      return mapped;
    } catch (err) {
      return rejectWithValue(err.message);
    }
  }
);


const weatherSlice = createSlice({
  name: "weather",
  initialState: {
    byId: {}, // key: ${lat}${lon}${units} -> { data, ts, status }
    status: "idle",
    error: null,
  },
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchWeatherFor.pending, (state) => {
        state.status = "loading";
        state.error = null;
      })
      .addCase(fetchWeatherFor.fulfilled, (state, action) => {
        state.status = "succeeded";
        const payload = action.payload;
        const key = `${payload.lat}_${payload.lon}_${payload.units || "metric"}`;

        state.byId[key] = { data: payload, ts: Date.now() };
      })
      .addCase(fetchWeatherFor.rejected, (state, action) => {
        state.status = "failed";
        state.error = action.payload;
      });
  },
});

const favoritesSlice = createSlice({
  name: "favorites",
  initialState: JSON.parse(localStorage.getItem("wad_favorites") || "[]"),
  reducers: {
    addFav: (state, action) => {
      if (!state.find((c) => c.id === action.payload.id)) state.push(action.payload);
      localStorage.setItem("wad_favorites", JSON.stringify(state));
    },
    removeFav: (state, action) => {
      const i = state.findIndex((c) => c.id === action.payload);
      if (i >= 0) state.splice(i, 1);
      localStorage.setItem("wad_favorites", JSON.stringify(state));
    },
  },
});

const settingsSlice = createSlice({
  name: "settings",
  initialState: {
    units: localStorage.getItem("wad_units") || "metric",
    autoRefresh: JSON.parse(localStorage.getItem("wad_autoRefresh") || "true"),
  },
  reducers: {
    setUnits: (state, action) => {
      state.units = action.payload;
      localStorage.setItem("wad_units", action.payload);
    },
    setAutoRefresh: (state, action) => {
      state.autoRefresh = action.payload;
      localStorage.setItem("wad_autoRefresh", JSON.stringify(action.payload));
    },
  },
});

const store = configureStore({
  reducer: {
    weather: weatherSlice.reducer,
    favorites: favoritesSlice.reducer,
    settings: settingsSlice.reducer,
  },
});

// --------------------------------------------------
// Helper: geocode (city search) using OpenWeatherMap Direct Geocoding
// --------------------------------------------------
/*async function geocodeCity(q) {
  const res = await axios.get(GEO_CODING_URL, {
    params: { q, limit: 5, appid: OWM_KEY },
  });
  return res.data; // array of matches
}*/
async function geocodeCity(q) {
  const res = await axios.get(GEO_CODING_URL, {
    params: { name: q, count: 5 },
  });
  return (res.data.results || []).map((r) => ({
    name: r.name,
    lat: r.latitude,
    lon: r.longitude,
    country: r.country,
    state: r.admin1 || "",
  }));
}

// --------------------------------------------------
// Small UI components
// --------------------------------------------------
function IconFromWeather({code, large = false}) {
  if (!code) return null;
  return (
    <img
      src={'https://openweathermap.org/img/wn/${code}@2x.png'}
      alt="wicon"
      className={large ? "w-20 h-20" : "w-12 h-12"}
    />
  );
}

function Spinner() {
  return <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-gray-900" />;
}

// CityCard
function CityCard({ city, units, onClick, onToggleFav, isFav }) {
  const [localData, setLocalData] = useState(null);
  const dispatch = useDispatch();
  const weatherState = useSelector((s) => s.weather);

  // attempt to find data in store by matching lat/lon & units
  useEffect(() => {
    const key = `${city.lat}_${city.lon}_${units}`;
    const entry = weatherState.byId[key];
    if (entry) setLocalData(entry.data);
  }, [weatherState, city.lat, city.lon, units]);

  if (!localData)
    return (
      <div className="bg-white/80 dark:bg-gray-800/60 p-4 rounded-lg shadow flex flex-col gap-2 w-64">
        <div className="flex justify-between items-start">
          <div className="font-semibold">
            {city.name}
            {city.state ? `, ${city.state}` : ""}

          </div>
          <button onClick={() => onToggleFav(city)} className="text-yellow-500">
            {isFav ? "★" : "☆"}
          </button>
        </div>
        <div className="flex items-center justify-center h-24">
          {weatherState.status === "loading" ? <Spinner /> : <div className="text-sm text-gray-500">No data</div>}
        </div>
        <button onClick={onClick} className="mt-auto bg-blue-500 text-white px-3 py-1 rounded">
          Open
        </button>
      </div>
    );

  const temp = Math.round(localData.current.temp);
  return (
    <div className="bg-white/80 dark:bg-gray-800/60 p-4 rounded-lg shadow flex flex-col gap-2 w-64">
      <div className="flex justify-between items-start">
        <div className="font-semibold">
          {city.name}
          {city.state ? `, ${city.state}` : ""}
        </div>
        <button onClick={() => onToggleFav(city)} className="text-yellow-500">
          {isFav ? "★" : "☆"}
        </button>
      </div>
      <div className="flex items-center gap-3">
        {IconFromWeather(localData.current.weather[0].icon, false)}
        <div>
          <div className="text-2xl font-bold">
            {temp}°{units === "metric" ? "C" : "F"}
          </div>
          <div className="text-sm text-gray-600">{localData.current.weather[0].description}</div>
        </div>
      </div>
      <div className="text-sm grid grid-cols-3 gap-2">
        <div>
          Humidity
          <br />
          <strong>{localData.current.humidity}%</strong>
        </div>
        <div>
          Wind
          <br />
          <strong>
            {localData.current.wind_speed}
            {units === "metric" ? " m/s" : " mph"}
          </strong>
        </div>
        <div>
          Pressure
          <br />
          <strong>{localData.current.pressure} hPa</strong>
        </div>
      </div>
      <button onClick={onClick} className="mt-auto bg-blue-500 text-white px-3 py-1 rounded">
        Open
      </button>
    </div>
  );
}

// Detailed Modal
function CityDetailModal({ city, onClose, units }) {
  const dispatch = useDispatch();
  const weatherState = useSelector((s) => s.weather);
  const [data, setData] = useState(null);

  useEffect(() => {
    const cacheKey = `onecall_${city.lat}_${city.lon}_${units}`;
    const cached = cacheGet(cacheKey);
    if (cached) {
      setData({ ...cached, lat: city.lat, lon: city.lon, units });
    }
    // request fresh data (thunk will use cache if still valid)
    dispatch(fetchWeatherFor({ lat: city.lat, lon: city.lon, units, name: city.name }));
  }, [city, units, dispatch]);

  useEffect(() => {
    const key = `${city.lat}_${city.lon}_${units}`;
    if (weatherState.byId[key]) setData(weatherState.byId[key].data);
  }, [weatherState, city.lat, city.lon, units]);

  // Auto refresh every 60s
  useEffect(() => {
    const iv = setInterval(() => {
      dispatch(fetchWeatherFor({ lat: city.lat, lon: city.lon, units, name: city.name }));
    }, 60_000);
    return () => clearInterval(iv);
  }, [city.lat, city.lon, units, dispatch, city.name]);

  if (!data)
    return (
      <div className="fixed inset-0 bg-black/40 flex items-center justify-center">
        <div className="bg-white p-6 rounded w-11/12 md:w-3/4">Loading...</div>
      </div>
    );

  // Prepare chart data
  const hourly = (data.hourly || [])
    .slice(0, 48)
    .map((h) => ({
      time: new Date(h.dt * 1000).toLocaleString(),
      temp: Math.round(h.temp),
      pop: Math.round((h.pop || 0) * 100),
      wind: h.wind_speed,
    }));
  const daily = (data.daily || [])
    .slice(0, 7)
    .map((d) => ({
      day: new Date(d.dt * 1000).toLocaleDateString(),
      min: Math.round(d.temp.min),
      max: Math.round(d.temp.max),
      pop: Math.round((d.pop || 0) * 100),
    }));

  return (
    <div className="fixed inset-0 bg-black/50 flex items-start justify-center p-6 overflow-auto z-50">
      <div className="bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 rounded-lg p-6 w-full md:w-11/12 lg:w-3/4">
        <div className="flex justify-between items-center">
          <div>
            <h2 className="text-2xl font-bold">
              {city.name} — {data.timezone || ""}
            </h2>
            <div className="text-sm text-gray-500">Updated: {new Date(data.current.dt * 1000).toLocaleString()}</div>
          </div>
          <div className="flex gap-2 items-center">
            <button onClick={onClose} className="px-3 py-1 bg-gray-200 rounded">
              Close
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
          <div className="col-span-1 bg-gray-50 p-4 rounded">
            <div className="flex items-center gap-4">
              {IconFromWeather(data.current.weather[0].icon, true)}
              <div>
                <div className="text-3xl font-bold">
                  {Math.round(data.current.temp)}°{units === "metric" ? "C" : "F"}
                </div>
                <div className="text-sm text-gray-600">{data.current.weather[0].description}</div>
              </div>
            </div>
            <div className="mt-4 text-sm grid grid-cols-2 gap-2">
              <div>
                Humidity: <strong>{data.current.humidity}%</strong>
              </div>
              <div>
                Pressure: <strong>{data.current.pressure} hPa</strong>
              </div>
              <div>
                UV Index: <strong>{data.current.uvi}</strong>
              </div>
              <div>
                Dew Point: <strong>{Math.round(data.current.dew_point)}°</strong>
              </div>
              <div>
                Wind: <strong>{data.current.wind_speed}{units === "metric" ? " m/s" : " mph"}</strong>
              </div>
              <div>
                Clouds: <strong>{data.current.clouds}%</strong>
              </div>
            </div>
          </div>

          <div className="col-span-2 bg-white p-4 rounded">
            <h3 className="font-semibold">Hourly temperature (48h)</h3>
            <div style={{ height: 220 }}>
              <ResponsiveContainer>
                <LineChart data={hourly}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="time" hide />
                  <YAxis />
                  <Tooltip />
                  <Line type="monotone" dataKey="temp" stroke="#8884d8" dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            <h3 className="font-semibold mt-4">7-day min/max</h3>
            <div style={{ height: 220 }}>
              <ResponsiveContainer>
                <AreaChart data={daily}>
                  <defs>
                    <linearGradient id="colorMax" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopOpacity={0.8} />
                      <stop offset="95%" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="day" hide />
                  <YAxis />
                  <Tooltip />
                  <Area type="monotone" dataKey="max" stroke="#ff7300" fillOpacity={1} />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            <h3 className="font-semibold mt-4">Precipitation chance (7d)</h3>
            <div style={{ height: 120 }}>
              <ResponsiveContainer>
                <LineChart data={daily}>
                  <XAxis dataKey="day" hide />
                  <YAxis />
                  <Tooltip />
                  <Line dataKey="pop" stroke="#1976d2" dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// SearchBar component with debounce and autocomplete
function SearchBar({ onSelect }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!q || q.length < 2) {
      setResults([]);
      return;
    }
    const iv = setTimeout(() => {
      setLoading(true);
      geocodeCity(q)
        .then((r) => {
          setResults(r);
          setLoading(false);
        })
        .catch(() => setLoading(false));
    }, 350);
    return () => clearTimeout(iv);
  }, [q]);

  return (
    <div className="relative">
      <input
        className="border p-2 rounded w-80"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search city (e.g. London)"
      />
      {loading && (
        <div className="absolute right-2 top-2">
          <Spinner />
        </div>
      )}
      {results.length > 0 && (
        <div className="absolute bg-white mt-1 rounded shadow w-80 z-40 max-h-64 overflow-auto">
          {results.map((r, idx) => (
            <div
              key={idx}
              className="p-2 hover:bg-gray-100 cursor-pointer"
              onClick={() => {
                onSelect({
                  id: r.lat + "_" + r.lon,
                  name: r.name,
                  lat: r.lat,
                  lon: r.lon,
                  state: r.state,
                  country: r.country,
                });
                setQ("");
                setResults([]);
              }}
            >
              <div className="font-semibold">
                {r.name}
                {r.state ? `, ${r.state}` : ""} <span className="text-xs">{r.country}</span>
              </div>
              <div className="text-xs text-gray-500">
                Lat: {r.lat.toFixed(2)}, Lon: {r.lon.toFixed(2)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Main App
function AppMain() {
  const dispatch = useDispatch();
  const favorites = useSelector((s) => s.favorites);
  const units = useSelector((s) => s.settings.units);
  const [selectedCity, setSelectedCity] = useState(null);
  const [cities, setCities] = useState([]);

  // initialize from favorites
  useEffect(() => {
    setCities(favorites.length ? favorites : [{ id: "nyc", name: "New York", lat: 40.7128, lon: -74.006, country: "US" }]);
  }, []); // intent: run once

  // when cities change or units change, fetch weather
  useEffect(() => {
    cities.forEach((c) => {
      dispatch(fetchWeatherFor({ lat: c.lat, lon: c.lon, units, name: c.name }));
    });
  }, [cities, units, dispatch]);

  // handle auto-refresh for visible cities every 60s
  useEffect(() => {
    const iv = setInterval(() => {
      cities.forEach((c) => dispatch(fetchWeatherFor({ lat: c.lat, lon: c.lon, units, name: c.name })));
    }, 60_000);
    return () => clearInterval(iv);
  }, [cities, units, dispatch]);

  function handleAddCity(city) {
    if (!cities.find((c) => c.id === city.id)) setCities((prev) => [city, ...prev]);
  }

  function toggleFavorite(city) {
    const exists = favorites.find((f) => f.id === city.id);
    if (exists) dispatch(favoritesSlice.actions.removeFav(city.id));
    else dispatch(favoritesSlice.actions.addFav(city));
  }

  function toggleUnits() {
    dispatch(settingsSlice.actions.setUnits(units === "metric" ? "imperial" : "metric"));
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-sky-100 to-white dark:from-gray-800 dark:to-gray-900 p-6">
      <header className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Weather Analytics Dashboard</h1>
        <div className="flex items-center gap-4">
          <SearchBar onSelect={handleAddCity} />
          <button onClick={toggleUnits} className="px-3 py-1 bg-gray-200 rounded">
            Units: {units === "metric" ? "C" : "F"}
          </button>
        </div>
      </header>

      <section>
        <h2 className="font-semibold mb-3">Pinned cities</h2>
        <div className="flex gap-4 overflow-auto pb-4">
          {cities.map((c) => (
            <CityCard
              key={c.id}
              city={c}
              units={units}
              onClick={() => setSelectedCity(c)}
              onToggleFav={toggleFavorite}
              isFav={!!favorites.find((f) => f.id === c.id)}
            />
          ))}
        </div>
      </section>

      <section className="mt-6">
        <h2 className="font-semibold mb-3">Favorites</h2>
        <div className="flex gap-3 flex-wrap">
          {favorites.length === 0 && <div className="text-sm text-gray-500">No favorites yet. Click ☆ on a city card to favorite it.</div>}
          {favorites.map((f) => (
            <div key={f.id} className="bg-white p-2 rounded shadow">
              {f.name}{" "}
              <button className="ml-2 text-red-500" onClick={() => dispatch(favoritesSlice.actions.removeFav(f.id))}>
                Remove
              </button>
            </div>
          ))}
        </div>
      </section>

      {selectedCity && <CityDetailModal city={selectedCity} onClose={() => setSelectedCity(null)} units={units} />}
      
      <footer className="mt-8 text-sm text-gray-600">
        Data from Open-Meteo (free, no API key). Cache TTL: 60s.
      </footer>
    
    </div>
  );
}

// Root app wrapper with provider
function App() {
  return (
    <Provider store={store}>
      <AppMain />
    </Provider>
  );
}

// Mount when used as standalone preview
const rootEl = document.getElementById("root");
if (rootEl) {
  const root = createRoot(rootEl);
  root.render(<App />);
}

export default App;

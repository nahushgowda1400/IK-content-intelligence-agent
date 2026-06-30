// lib/airtable.js
// Airtable REST API helper — supports two separate bases (Sources + Raw Stories)

const BASE_URL = "https://api.airtable.com/v0";

function headers() {
  return {
    Authorization: `Bearer ${process.env.AIRTABLE_TOKEN}`,
    "Content-Type": "application/json",
  };
}

async function fetchWithRetry(url, options = {}, retries = 3, delayMs = 1000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fetch(url, options);
    } catch (err) {
      if (attempt === retries) throw err;
      console.warn(`  ⚠ fetch attempt ${attempt} failed (${err.message}), retrying in ${delayMs}ms...`);
      await sleep(delayMs);
      delayMs *= 2;
    }
  }
}

/**
 * Fetch ALL records from a table, handling Airtable's 100-record pagination.
 * @param {string} tableName
 * @param {object} options — { filterByFormula, fields[], maxRecords, baseId }
 */
export async function getAllRecords(tableName, options = {}) {
  const baseId = options.baseId || process.env.AIRTABLE_BASE_ID_SOURCES;
  const records = [];
  let offset = null;

  do {
    const params = new URLSearchParams();
    if (options.filterByFormula) params.set("filterByFormula", options.filterByFormula);
    if (options.fields) options.fields.forEach((f) => params.append("fields[]", f));
    if (options.maxRecords) params.set("maxRecords", options.maxRecords);
    if (offset) params.set("offset", offset);

    const url = `${BASE_URL}/${baseId}/${encodeURIComponent(tableName)}?${params}`;
    const res = await fetchWithRetry(url, { headers: headers() });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Airtable GET failed [${res.status}]: ${err}`);
    }

    const data = await res.json();
    records.push(...data.records);
    offset = data.offset || null;

    if (offset) await sleep(250);
  } while (offset);

  return records;
}

/**
 * Create multiple records. Airtable max is 10 per request — auto-batched.
 * @param {string} tableName
 * @param {Array} fields — array of field objects
 * @param {object} options — { baseId }
 */
export async function createRecords(tableName, fields, options = {}) {
  const baseId = options.baseId || process.env.AIRTABLE_BASE_ID_SOURCES;
  const created = [];
  const batches = chunkArray(fields, 10);

  for (const batch of batches) {
    const body = { records: batch.map((f) => ({ fields: f })) };
    const url = `${BASE_URL}/${baseId}/${encodeURIComponent(tableName)}`;
    const res = await fetchWithRetry(url, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Airtable POST failed [${res.status}]: ${err}`);
    }

    const data = await res.json();
    created.push(...data.records);
    if (batches.length > 1) await sleep(250);
  }

  return created;
}

/**
 * Update multiple records.
 * @param {string} tableName
 * @param {Array} updates — array of { id, fields } objects
 * @param {object} options — { baseId }
 */
export async function updateRecords(tableName, updates, options = {}) {
  const baseId = options.baseId || process.env.AIRTABLE_BASE_ID_SOURCES;
  const batches = chunkArray(updates, 10);

  for (const batch of batches) {
    const body = { records: batch.map(({ id, fields }) => ({ id, fields })) };
    const url = `${BASE_URL}/${baseId}/${encodeURIComponent(tableName)}`;
    const res = await fetchWithRetry(url, {
      method: "PATCH",
      headers: headers(),
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Airtable PATCH failed [${res.status}]: ${err}`);
    }

    if (batches.length > 1) await sleep(250);
  }
}

function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

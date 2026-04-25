import express from "express";
import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import multer from "multer";
import { closePool, pool } from "./db.js";

const app = express();
const port = process.env.PORT || 4000;
const uploadDirectory = "/app/uploads/signatures";
const robotEventsApiBaseUrl = "https://www.robotevents.com/api/v2";
const robotEventsApiKey = process.env.ROBOTEVENTS_API_KEY ?? "";
const robotEventsSyncToken = process.env.ROBOTEVENTS_SYNC_TOKEN ?? "";
const allowedOrigins = (process.env.CORS_ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024,
  },
});

app.use(express.json({ limit: "5mb" }));
app.use((req, res, next) => {
  const origin = req.headers.origin;

  if (allowedOrigins.length === 0) {
    res.setHeader("Access-Control-Allow-Origin", origin || "*");
  } else if (origin && allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }

  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }

  return next();
});

app.use("/uploads", express.static("/app/uploads"));

function mapEventRow(row) {
  return {
    id: row.id,
    robotEventsEventId: row.robotevents_event_id,
    eventCode: row.event_code,
    name: row.name,
    programName: row.program_name,
    programCode: row.program_code,
    seasonName: row.season_name,
    seasonCode: row.season_code,
    locationVenue: row.location_venue,
    locationCity: row.location_city,
    locationRegion: row.location_region,
    locationCountry: row.location_country,
    startAt: row.start_at,
    endAt: row.end_at,
    importedAt: row.imported_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapTeamRow(row) {
  return {
    id: row.id,
    eventId: row.event_id,
    eventCode: row.event_code,
    eventName: row.event_name,
    teamNumber: row.team_number,
    teamName: row.team_name,
    organization: row.organization,
    contactNumber: row.contact_number,
    contactName: row.contact_name,
    signatureImagePath: row.signature_image_path,
    preCheckedIn: row.pre_checked_in,
    checkedIn: row.checked_in,
    wristbandsEstimated: row.wristbands_estimated,
    wristbandsActual: row.wristbands_actual,
    parkingPass: row.parking_pass,
    pickupName: row.pickup_name,
    pickupPhoneNumber: row.pickup_phone_number,
    pickupNotes: row.pickup_notes,
    checkedInAt: row.checked_in_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function parseBoolean(value, fieldName) {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();

    if (normalized === "true") {
      return true;
    }

    if (normalized === "false") {
      return false;
    }
  }

  throw new Error(`${fieldName} must be a boolean`);
}

function parseOptionalInteger(value, fieldName, min = 0, max = 500) {
  if (value === null) {
    return null;
  }

  const parsed =
    typeof value === "number" ? value : Number.parseInt(String(value), 10);

  if (!Number.isInteger(parsed)) {
    throw new Error(`${fieldName} must be an integer`);
  }

  if (parsed < min || parsed > max) {
    throw new Error(`${fieldName} must be between ${min} and ${max}`);
  }

  return parsed;
}

function parseOptionalString(value, fieldName) {
  if (value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new Error(`${fieldName} must be a string`);
  }

  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function parseOptionalNotes(value, fieldName, maxLength = 1000) {
  const parsed = parseOptionalString(value, fieldName);

  if (parsed !== null && parsed.length > maxLength) {
    throw new Error(`${fieldName} must be ${maxLength} characters or fewer`);
  }

  return parsed;
}

function parsePhoneNumber(value, fieldName) {
  const parsed = parseOptionalString(value, fieldName);

  if (parsed === null) {
    return null;
  }

  if (!/^\+[1-9]\d{1,14}$/.test(parsed)) {
    throw new Error(`${fieldName} must be a valid E.164 phone number`);
  }

  return parsed;
}

function requireRobotEventsApiKey() {
  if (!robotEventsApiKey) {
    const error = new Error("ROBOTEVENTS_API_KEY is not configured");
    error.statusCode = 500;
    throw error;
  }
}

function requireRobotEventsSyncAuthorization(req) {
  if (!robotEventsSyncToken) {
    const error = new Error("ROBOTEVENTS_SYNC_TOKEN is not configured");
    error.statusCode = 500;
    throw error;
  }

  const authorization = String(req.headers.authorization ?? "");
  const token = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : "";

  if (token !== robotEventsSyncToken) {
    const error = new Error("Invalid RobotEvents sync token");
    error.statusCode = 401;
    throw error;
  }
}

async function fetchRobotEventsJson(resourcePath) {
  requireRobotEventsApiKey();

  const response = await fetch(`${robotEventsApiBaseUrl}${resourcePath}`, {
    headers: {
      Authorization: `Bearer ${robotEventsApiKey}`,
      Accept: "application/json",
    },
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const message =
      payload?.message ||
      payload?.error ||
      `RobotEvents request failed with status ${response.status}`;
    const error = new Error(message);
    error.statusCode = response.status;
    throw error;
  }

  return payload;
}

async function fetchRobotEventByCode(eventCode) {
  const payload = await fetchRobotEventsJson(
    `/events?sku=${encodeURIComponent(eventCode)}`,
  );
  const event = payload?.data?.[0];

  if (!event) {
    const error = new Error(`No RobotEvents event found for code ${eventCode}`);
    error.statusCode = 404;
    throw error;
  }

  return event;
}

function normalizeRobotEventTeam(team) {
  const teamNumber = String(
    team?.number ??
      team?.team?.number ??
      team?.teamNumber ??
      team?.team_number ??
      "",
  ).trim();

  if (teamNumber === "") {
    return null;
  }

  const teamName = String(
    team?.team_name ??
      team?.team?.team_name ??
      team?.name ??
      team?.team?.name ??
      "",
  ).trim();
  const organization = String(
    team?.organization ?? team?.team?.organization ?? "",
  ).trim();

  return {
    number: teamNumber,
    team_name: teamName === "" ? teamNumber : teamName,
    organization: organization === "" ? null : organization,
  };
}

async function fetchRobotEventTeams(eventId) {
  const teams = [];
  let currentPage = 1;
  let lastPage = 1;

  do {
    const payload = await fetchRobotEventsJson(
      `/events/${eventId}/teams?page=${currentPage}`,
    );

    teams.push(
      ...(payload?.data ?? [])
        .map(normalizeRobotEventTeam)
        .filter(Boolean),
    );
    lastPage =
      payload?.meta?.last_page ??
      payload?.meta?.lastPage ??
      payload?.meta?.pagination?.last_page ??
      currentPage;
    currentPage += 1;
  } while (currentPage <= lastPage);

  return teams;
}

async function upsertEvent(event) {
  const result = await pool.query(
    `
      INSERT INTO events (
        robotevents_event_id,
        event_code,
        name,
        program_name,
        program_code,
        season_name,
        season_code,
        location_venue,
        location_city,
        location_region,
        location_country,
        start_at,
        end_at,
        active,
        imported_at,
        updated_at
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW(), NOW()
      )
      ON CONFLICT (event_code)
      DO UPDATE SET
        robotevents_event_id = EXCLUDED.robotevents_event_id,
        name = EXCLUDED.name,
        program_name = EXCLUDED.program_name,
        program_code = EXCLUDED.program_code,
        season_name = EXCLUDED.season_name,
        season_code = EXCLUDED.season_code,
        location_venue = EXCLUDED.location_venue,
        location_city = EXCLUDED.location_city,
        location_region = EXCLUDED.location_region,
        location_country = EXCLUDED.location_country,
        start_at = EXCLUDED.start_at,
        end_at = EXCLUDED.end_at,
        imported_at = NOW(),
        updated_at = NOW()
      RETURNING
        id,
        robotevents_event_id,
        event_code,
        name,
        program_name,
        program_code,
        season_name,
        season_code,
        location_venue,
        location_city,
        location_region,
        location_country,
        start_at,
        end_at,
        active,
        checkin_last_synced_at,
        checkin_sync_error,
        imported_at,
        created_at,
        updated_at
    `,
    [
      event.id,
      event.sku,
      event.name,
      event.program?.name ?? null,
      event.program?.code ?? null,
      event.season?.name ?? null,
      event.season?.code ?? null,
      event.location?.venue ?? null,
      event.location?.city ?? null,
      event.location?.region ?? null,
      event.location?.country ?? null,
      event.start ?? null,
      event.end ?? null,
      Boolean(event.ongoing),
    ],
  );

  return result.rows[0];
}

async function upsertEventTeams(eventRow, teams) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const importedNumbers = new Set();

    for (const team of teams) {
      importedNumbers.add(team.number);

      await client.query(
        `
          INSERT INTO teams (
            event_id,
            team_number,
            team_name,
            organization,
            contact_number,
            contact_name,
            updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, NOW())
          ON CONFLICT (event_id, team_number)
          DO UPDATE SET
            team_name = EXCLUDED.team_name,
            organization = EXCLUDED.organization,
            contact_number = EXCLUDED.contact_number,
            contact_name = EXCLUDED.contact_name,
            updated_at = NOW()
        `,
        [
          eventRow.id,
          team.number,
          team.team_name,
          team.organization ?? null,
          null,
          null,
        ],
      );
    }

    if (importedNumbers.size > 0) {
      await client.query(
        `
          DELETE FROM teams
          WHERE event_id = $1
            AND NOT (team_number = ANY($2::text[]))
        `,
        [eventRow.id, [...importedNumbers]],
      );
    } else {
      await client.query("DELETE FROM teams WHERE event_id = $1", [eventRow.id]);
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function getEvents() {
  const result = await pool.query(
    `
      SELECT
        id,
        robotevents_event_id,
        event_code,
        name,
        program_name,
        program_code,
        season_name,
        season_code,
        location_venue,
        location_city,
        location_region,
        location_country,
        start_at,
        end_at,
        active,
        checkin_last_synced_at,
        checkin_sync_error,
        imported_at,
        created_at,
        updated_at
      FROM events
      ORDER BY start_at DESC NULLS LAST, name ASC
    `,
  );

  return result.rows.map(mapEventRow);
}

async function getTeamsByEventId(eventId) {
  const result = await pool.query(
    `
      SELECT
        teams.id,
        teams.event_id,
        events.event_code,
        events.name AS event_name,
        teams.team_number,
        teams.team_name,
        teams.organization,
        teams.contact_number,
        teams.contact_name,
        teams.signature_image_path,
        teams.pre_checked_in,
        teams.checked_in,
        teams.wristbands_estimated,
        teams.wristbands_actual,
        teams.parking_pass,
        teams.pickup_name,
        teams.pickup_phone_number,
        teams.pickup_notes,
        teams.checked_in_at,
        teams.created_at,
        teams.updated_at
      FROM teams
      INNER JOIN events ON events.id = teams.event_id
      WHERE teams.event_id = $1
      ORDER BY teams.team_number ASC
    `,
    [eventId],
  );

  return result.rows.map(mapTeamRow);
}

async function getEventById(eventId) {
  const result = await pool.query(
    `
      SELECT
        id,
        robotevents_event_id,
        event_code,
        name,
        program_name,
        program_code,
        season_name,
        season_code,
        location_venue,
        location_city,
        location_region,
        location_country,
        start_at,
        end_at,
        active,
        checkin_last_synced_at,
        checkin_sync_error,
        imported_at,
        created_at,
        updated_at
      FROM events
      WHERE id = $1
    `,
    [eventId],
  );

  return result.rows[0] ? mapEventRow(result.rows[0]) : null;
}

async function getEventByRobotEventsEventId(robotEventsEventId) {
  const result = await pool.query(
    `
      SELECT
        id,
        robotevents_event_id,
        event_code,
        name,
        program_name,
        program_code,
        season_name,
        season_code,
        location_venue,
        location_city,
        location_region,
        location_country,
        start_at,
        end_at,
        active,
        checkin_last_synced_at,
        checkin_sync_error,
        imported_at,
        created_at,
        updated_at
      FROM events
      WHERE robotevents_event_id = $1
    `,
    [robotEventsEventId],
  );

  return result.rows[0] ? mapEventRow(result.rows[0]) : null;
}

function parseCsv(csvText) {
  const rows = [];
  let currentCell = "";
  let currentRow = [];
  let insideQuotes = false;

  for (let index = 0; index < csvText.length; index += 1) {
    const character = csvText[index];
    const nextCharacter = csvText[index + 1];

    if (character === '"') {
      if (insideQuotes && nextCharacter === '"') {
        currentCell += '"';
        index += 1;
      } else {
        insideQuotes = !insideQuotes;
      }

      continue;
    }

    if (character === "," && !insideQuotes) {
      currentRow.push(currentCell);
      currentCell = "";
      continue;
    }

    if ((character === "\n" || character === "\r") && !insideQuotes) {
      if (character === "\r" && nextCharacter === "\n") {
        index += 1;
      }

      currentRow.push(currentCell);
      rows.push(currentRow);
      currentRow = [];
      currentCell = "";
      continue;
    }

    currentCell += character;
  }

  if (currentCell !== "" || currentRow.length > 0) {
    currentRow.push(currentCell);
    rows.push(currentRow);
  }

  return rows.filter((row) => row.some((value) => String(value ?? "").trim() !== ""));
}

function normalizeHeader(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function findColumnIndex(headers, aliases) {
  const normalizedAliases = aliases.map(normalizeHeader);

  return headers.findIndex((header) =>
    normalizedAliases.includes(normalizeHeader(header)),
  );
}

function toNullableString(value) {
  const trimmedValue = String(value ?? "").trim();
  return trimmedValue === "" ? null : trimmedValue;
}

function toNullableInteger(value) {
  const trimmedValue = String(value ?? "").trim();

  if (trimmedValue === "") {
    return null;
  }

  const parsed = Number.parseInt(trimmedValue, 10);
  return Number.isInteger(parsed) ? parsed : null;
}

function sumNullableIntegers(values) {
  const integers = values.filter((value) => Number.isInteger(value));

  if (integers.length === 0) {
    return null;
  }

  return integers.reduce((total, value) => total + value, 0);
}

function extractCheckInRowsFromCsv(csvText) {
  const rows = parseCsv(csvText);

  if (rows.length === 0) {
    return [];
  }

  const headers = rows[0];
  const teamNumberIndex = findColumnIndex(headers, [
    "teamnumber",
    "team",
    "number",
    "enterintheteamnumberyouarecompletingthischeckinsurveyfor",
  ]);
  const teamNameIndex = findColumnIndex(headers, ["teamname"]);
  const organizationIndex = findColumnIndex(headers, ["organization", "school"]);
  const contactNameIndex = findColumnIndex(headers, [
    "contactname",
    "primarycontactname",
    "contact",
    "inpersoncoach",
  ]);
  const firstNameIndex = findColumnIndex(headers, ["firstname"]);
  const lastNameIndex = findColumnIndex(headers, ["lastname"]);
  const contactPhoneIndex = findColumnIndex(headers, [
    "contactnumber",
    "contactphone",
    "phonenumber",
    "phone",
    "primarycontactphone",
    "primaryphone",
    "inpersoncoachphonenumber",
  ]);
  const wristbandsIndex = findColumnIndex(headers, [
    "totalwristbands",
    "totalnumberwristbands",
    "wristbands",
    "numwristbands",
  ]);
  const studentsMaleIndex = findColumnIndex(headers, ["studentsmale"]);
  const studentsFemaleIndex = findColumnIndex(headers, ["studentsfemale"]);
  const studentsNonBinaryIndex = findColumnIndex(headers, ["studentsnonbinary"]);
  const studentsUnspecifiedIndex = findColumnIndex(headers, [
    "studentsunspecifiedgender",
  ]);
  const mentorsIndex = findColumnIndex(headers, ["mentors"]);
  const familyIndex = findColumnIndex(headers, ["family"]);
  const coachesIndex = findColumnIndex(headers, ["coaches"]);
  const studentsIndex = findColumnIndex(headers, ["students"]);

  if (teamNumberIndex === -1) {
    throw new Error("Check-in CSV does not contain a recognizable team number column");
  }

  return rows.slice(1).map((row) => ({
    teamNumber: toNullableString(row[teamNumberIndex]),
    teamName: teamNameIndex === -1 ? null : toNullableString(row[teamNameIndex]),
    organization:
      organizationIndex === -1 ? null : toNullableString(row[organizationIndex]),
    contactName: (() => {
      const directContactName =
        contactNameIndex === -1 ? null : toNullableString(row[contactNameIndex]);

      if (directContactName) {
        return directContactName;
      }

      const firstName =
        firstNameIndex === -1 ? null : toNullableString(row[firstNameIndex]);
      const lastName =
        lastNameIndex === -1 ? null : toNullableString(row[lastNameIndex]);
      const combinedName = [firstName, lastName].filter(Boolean).join(" ").trim();

      return combinedName === "" ? null : combinedName;
    })(),
    contactNumber:
      contactPhoneIndex === -1 ? null : toNullableString(row[contactPhoneIndex]),
    wristbandsEstimated: (() => {
      if (wristbandsIndex !== -1) {
        const explicitWristbands = toNullableInteger(row[wristbandsIndex]);

        if (explicitWristbands !== null) {
          return explicitWristbands;
        }
      }

      const attendeeTotal = sumNullableIntegers([
        studentsMaleIndex === -1 ? null : toNullableInteger(row[studentsMaleIndex]),
        studentsFemaleIndex === -1
          ? null
          : toNullableInteger(row[studentsFemaleIndex]),
        studentsNonBinaryIndex === -1
          ? null
          : toNullableInteger(row[studentsNonBinaryIndex]),
        studentsUnspecifiedIndex === -1
          ? null
          : toNullableInteger(row[studentsUnspecifiedIndex]),
        mentorsIndex === -1 ? null : toNullableInteger(row[mentorsIndex]),
        familyIndex === -1 ? null : toNullableInteger(row[familyIndex]),
      ]);

      if (attendeeTotal !== null) {
        return attendeeTotal;
      }

      return sumNullableIntegers([
        coachesIndex === -1 ? null : toNullableInteger(row[coachesIndex]),
        studentsIndex === -1 ? null : toNullableInteger(row[studentsIndex]),
      ]);
    })(),
  }))
    .filter((row) => row.teamNumber !== null);
}

async function updateEventSyncStatus(eventId, { lastSyncedAt = null, error = null }) {
  await pool.query(
    `
      UPDATE events
      SET
        checkin_last_synced_at = $2,
        checkin_sync_error = $3,
        updated_at = NOW()
      WHERE id = $1
    `,
    [eventId, lastSyncedAt, error],
  );
}

async function syncEventCheckInCsvText(event, csvText) {
  const checkInRows = extractCheckInRowsFromCsv(csvText);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    await client.query(
      `
        UPDATE teams
        SET
          pre_checked_in = FALSE,
          updated_at = NOW()
        WHERE event_id = $1
      `,
      [event.id],
    );

    for (const row of checkInRows) {
      await client.query(
        `
          UPDATE teams
          SET
            pre_checked_in = TRUE,
            team_name = COALESCE($3, team_name),
            organization = COALESCE($4, organization),
            contact_name = COALESCE($5, contact_name),
            contact_number = COALESCE($6, contact_number),
            wristbands_estimated = COALESCE($7, wristbands_estimated),
            updated_at = NOW()
          WHERE event_id = $1
            AND team_number = $2
        `,
        [
          event.id,
          row.teamNumber,
          row.teamName,
          row.organization,
          row.contactName,
          row.contactNumber,
          row.wristbandsEstimated,
        ],
      );
    }

    await client.query("COMMIT");
    await updateEventSyncStatus(event.id, {
      lastSyncedAt: new Date(),
      error: null,
    });

    return {
      syncedTeamCount: checkInRows.length,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    await updateEventSyncStatus(event.id, {
      lastSyncedAt: null,
      error: error.message,
    });
    throw error;
  } finally {
    client.release();
  }
}

app.get("/", (_req, res) => {
  res.json({ message: "Backend is running" });
});

app.get("/api/health", async (_req, res) => {
  try {
    const result = await pool.query("SELECT NOW() AS now");
    res.json({
      ok: true,
      databaseTime: result.rows[0].now,
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: "Database connection failed",
      details: error.message,
    });
  }
});

app.get("/api/events", async (_req, res) => {
  try {
    res.json(await getEvents());
  } catch (error) {
    res.status(500).json({
      error: "Failed to fetch events",
      details: error.message,
    });
  }
});

app.post("/api/events/import", async (req, res) => {
  const eventCode = String(req.body.eventCode ?? "").trim();

  if (eventCode === "") {
    return res.status(400).json({ error: "eventCode is required" });
  }

  try {
    const robotEvent = await fetchRobotEventByCode(eventCode);
    const eventRow = await upsertEvent(robotEvent);
    const robotTeams = await fetchRobotEventTeams(robotEvent.id);

    if (robotTeams.length === 0) {
      const error = new Error(
        `RobotEvents returned zero teams for event ${eventCode}. The event was created, but no teams were imported.`,
      );
      error.statusCode = 502;
      throw error;
    }

    await upsertEventTeams(eventRow, robotTeams);

    const importedEvent = await getEventById(eventRow.id);

    const importedTeams = await getTeamsByEventId(eventRow.id);

    return res.status(201).json({
      event: importedEvent,
      importedTeamCount: importedTeams.length,
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      error: "Failed to import event",
      details: error.message,
    });
  }
});

app.post("/api/events/robotevents/:robotEventsEventId/checkin-csv-upload", async (req, res) => {
  const robotEventsEventId = Number.parseInt(req.params.robotEventsEventId, 10);

  if (!Number.isInteger(robotEventsEventId)) {
    return res.status(400).json({
      error: "RobotEvents event id must be an integer",
    });
  }

  try {
    requireRobotEventsSyncAuthorization(req);

    const event = await getEventByRobotEventsEventId(robotEventsEventId);

    if (!event) {
      return res.status(404).json({
        error: "Imported event not found for this RobotEvents event id",
      });
    }

    if (typeof req.body?.csvText !== "string" || req.body.csvText.trim() === "") {
      return res.status(400).json({
        error: "csvText is required",
      });
    }

    const result = await syncEventCheckInCsvText(event, req.body.csvText);
    const updatedEvent = await getEventById(event.id);

    return res.status(201).json({
      event: updatedEvent,
      syncedTeamCount: result.syncedTeamCount,
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      error: "Failed to upload RobotEvents check-in CSV",
      details: error.message,
    });
  }
});

app.get("/api/events/:eventId/teams", async (req, res) => {
  const eventId = Number.parseInt(req.params.eventId, 10);

  if (!Number.isInteger(eventId)) {
    return res.status(400).json({ error: "Event id must be an integer" });
  }

  try {
    const event = await getEventById(eventId);

    if (!event) {
      return res.status(404).json({ error: "Event not found" });
    }

    return res.json(await getTeamsByEventId(eventId));
  } catch (error) {
    return res.status(500).json({
      error: "Failed to fetch event teams",
      details: error.message,
    });
  }
});


app.get("/api/teams/:id", async (req, res) => {
  const teamId = Number.parseInt(req.params.id, 10);

  if (!Number.isInteger(teamId)) {
    return res.status(400).json({ error: "Team id must be an integer" });
  }

  try {
    const result = await pool.query(
      `
        SELECT
          teams.id,
          teams.event_id,
          events.event_code,
          events.name AS event_name,
          teams.team_number,
          teams.team_name,
          teams.organization,
          teams.contact_number,
          teams.contact_name,
          teams.signature_image_path,
          teams.pre_checked_in,
          teams.checked_in,
          teams.wristbands_estimated,
          teams.wristbands_actual,
          teams.parking_pass,
          teams.pickup_name,
          teams.pickup_phone_number,
          teams.pickup_notes,
          teams.checked_in_at,
          teams.created_at,
          teams.updated_at
        FROM teams
        INNER JOIN events ON events.id = teams.event_id
        WHERE teams.id = $1
      `,
      [teamId],
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Team not found" });
    }

    return res.json(mapTeamRow(result.rows[0]));
  } catch (error) {
    return res.status(500).json({
      error: "Failed to fetch team",
      details: error.message,
    });
  }
});

async function updateTeam(req, res) {
  const teamId = Number.parseInt(req.params.id, 10);

  if (!Number.isInteger(teamId)) {
    return res.status(400).json({ error: "Team id must be an integer" });
  }

  const updates = [];
  const values = [];
  let parameterIndex = 1;

  const assign = (column, value) => {
    updates.push(`${column} = $${parameterIndex}`);
    values.push(value);
    parameterIndex += 1;
  };

  try {
    if (req.body.wristbandsEstimated !== undefined) {
      assign(
        "wristbands_estimated",
        parseOptionalInteger(req.body.wristbandsEstimated, "wristbandsEstimated"),
      );
    }

    if (req.body.wristbandsActual !== undefined) {
      assign(
        "wristbands_actual",
        parseOptionalInteger(req.body.wristbandsActual, "wristbandsActual"),
      );
    }

    if (req.body.parkingPass !== undefined) {
      assign("parking_pass", parseBoolean(req.body.parkingPass, "parkingPass"));
    }

    if (req.body.pickupName !== undefined) {
      assign("pickup_name", parseOptionalString(req.body.pickupName, "pickupName"));
    }

    if (req.body.pickupPhoneNumber !== undefined) {
      assign(
        "pickup_phone_number",
        parsePhoneNumber(req.body.pickupPhoneNumber, "pickupPhoneNumber"),
      );
    }

    if (req.body.pickupNotes !== undefined) {
      assign("pickup_notes", parseOptionalNotes(req.body.pickupNotes, "pickupNotes"));
    }

    if (req.body.preCheckedIn !== undefined) {
      assign("pre_checked_in", parseBoolean(req.body.preCheckedIn, "preCheckedIn"));
    }

    if (req.body.checkedIn !== undefined) {
      const checkedIn = parseBoolean(req.body.checkedIn, "checkedIn");
      assign("checked_in", checkedIn);
      assign("checked_in_at", checkedIn ? new Date() : null);
    }

    if (req.body.signatureImagePath !== undefined) {
      assign(
        "signature_image_path",
        parseOptionalString(req.body.signatureImagePath, "signatureImagePath"),
      );
    }
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }

  if (updates.length === 0) {
    return res.status(400).json({ error: "No valid fields provided to update" });
  }

  assign("updated_at", new Date());
  values.push(teamId);

  try {
    const result = await pool.query(
      `
        UPDATE teams
        SET ${updates.join(", ")}
        WHERE id = $${parameterIndex}
        RETURNING
          id
      `,
      values,
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Team not found" });
    }

    const updatedTeamResult = await pool.query(
      `
        SELECT
          teams.id,
          teams.event_id,
          events.event_code,
          events.name AS event_name,
          teams.team_number,
          teams.team_name,
          teams.organization,
          teams.contact_number,
          teams.contact_name,
          teams.signature_image_path,
          teams.pre_checked_in,
          teams.checked_in,
          teams.wristbands_estimated,
          teams.wristbands_actual,
          teams.parking_pass,
          teams.pickup_name,
          teams.pickup_phone_number,
          teams.pickup_notes,
          teams.checked_in_at,
          teams.created_at,
          teams.updated_at
        FROM teams
        INNER JOIN events ON events.id = teams.event_id
        WHERE teams.id = $1
      `,
      [teamId],
    );

    return res.json(mapTeamRow(updatedTeamResult.rows[0]));
  } catch (error) {
    return res.status(500).json({
      error: "Failed to update team",
      details: error.message,
    });
  }
}

app.put("/api/teams/:id", updateTeam);
app.patch("/api/teams/:id", updateTeam);

app.post("/api/uploads/signature", upload.single("signature"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "signature file is required" });
  }

  if (!req.file.mimetype.startsWith("image/")) {
    return res.status(400).json({ error: "signature must be an image file" });
  }

  const extension = path.extname(req.file.originalname).toLowerCase() || ".png";
  const filename = `${Date.now()}-${crypto.randomUUID()}${extension}`;
  const absolutePath = path.join(uploadDirectory, filename);

  try {
    await fs.mkdir(uploadDirectory, { recursive: true });
    await fs.writeFile(absolutePath, req.file.buffer);

    return res.status(201).json({
      path: `/uploads/signatures/${filename}`,
    });
  } catch (error) {
    return res.status(500).json({
      error: "Failed to upload signature",
      details: error.message,
    });
  }
});

const server = app.listen(port, "0.0.0.0", () => {
  console.log(`Backend listening on http://localhost:${port}`);
});

async function shutdown(signal) {
  console.log(`${signal} received, shutting down gracefully`);

  server.close(async () => {
    await closePool();
    process.exit(0);
  });
}

process.on("SIGINT", () => {
  shutdown("SIGINT").catch((error) => {
    console.error("Shutdown failed", error);
    process.exit(1);
  });
});

process.on("SIGTERM", () => {
  shutdown("SIGTERM").catch((error) => {
    console.error("Shutdown failed", error);
    process.exit(1);
  });
});

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { parsePhoneNumberFromString } from "libphonenumber-js";
import {
  Navigate,
  Route,
  Routes,
  useNavigate,
  useParams,
} from "react-router-dom";
import SignaturePad from "signature_pad";

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? "")
  .trim()
  .replace(/\/$/, "");

function createApiUrl(resourcePath) {
  if (!resourcePath) {
    return "";
  }

  if (/^https?:\/\//i.test(resourcePath)) {
    return resourcePath;
  }

  return apiBaseUrl
    ? `${apiBaseUrl}${resourcePath.startsWith("/") ? "" : "/"}${resourcePath}`
    : resourcePath;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<AppScreen />} />
      <Route path="/events/:eventId" element={<AppScreen />} />
      <Route path="/combined/:combinedId" element={<AppScreen />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function normalizeTeam(team) {
  const normalizedId = Number(team.id);

  return {
    ...team,
    id: Number.isInteger(normalizedId) ? normalizedId : team.id,
    organization: team.organization ?? "",
    contactName: team.contactName ?? "",
    contactNumber: team.contactNumber ?? "",
    pickupName: team.pickupName ?? "",
    pickupPhoneNumber: team.pickupPhoneNumber ?? "",
    pickupNotes: team.pickupNotes ?? "",
    parkingPass: Boolean(team.parkingPass),
    signaturePreview: team.signatureImagePath
      ? createApiUrl(team.signatureImagePath)
      : null,
  };
}

const columns = [
  { key: "teamNumber", label: "Team #" },
  { key: "teamName", label: "Team Name" },
  { key: "preCheckedIn", label: "Pre-Checked In" },
  { key: "checkedIn", label: "Fully Checked In" },
];

const pageSizeOptions = [10, 20, 50, 100, "all"];
const triStateOptions = [
  { value: "any", label: "Any" },
  { value: "true", label: "Yes" },
  { value: "false", label: "No" },
];
const combinedDashboardsStorageKey = "worldscheckin-combined-dashboards";
const combinedStatusPalettes = {
  checkedIn: ["#047857", "#059669", "#10b981", "#34d399", "#6ee7b7"],
  preCheckedOnly: ["#b45309", "#d97706", "#f59e0b", "#fbbf24", "#fcd34d"],
  notPreChecked: ["#9f1239", "#be123c", "#e11d48", "#f43f5e", "#fb7185"],
};

function loadCombinedDashboards() {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const rawValue = window.localStorage.getItem(combinedDashboardsStorageKey);

    if (!rawValue) {
      return [];
    }

    const parsedValue = JSON.parse(rawValue);

    if (!Array.isArray(parsedValue)) {
      return [];
    }

    return parsedValue
      .map((dashboard) => ({
        id: String(dashboard?.id ?? ""),
        name: String(dashboard?.name ?? "").trim(),
        eventIds: Array.isArray(dashboard?.eventIds)
          ? dashboard.eventIds
              .map((eventId) => Number(eventId))
              .filter((eventId) => Number.isInteger(eventId))
          : [],
      }))
      .filter(
        (dashboard) => dashboard.id !== "" && dashboard.name !== "" && dashboard.eventIds.length > 0,
      );
  } catch (_error) {
    return [];
  }
}

function saveCombinedDashboards(dashboards) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(
    combinedDashboardsStorageKey,
    JSON.stringify(dashboards),
  );
}

function createCombinedDashboardId() {
  return `combined-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function compareValues(a, b, direction) {
  if (typeof a === "boolean" && typeof b === "boolean") {
    return direction === "asc" ? Number(a) - Number(b) : Number(b) - Number(a);
  }

  if (typeof a === "number" && typeof b === "number") {
    return direction === "asc" ? a - b : b - a;
  }

  const left = String(a ?? "").toLowerCase();
  const right = String(b ?? "").toLowerCase();

  return direction === "asc"
    ? left.localeCompare(right)
    : right.localeCompare(left);
}

function compareTeamNumbers(leftValue, rightValue, direction) {
  const left = String(leftValue ?? "").trim();
  const right = String(rightValue ?? "").trim();
  const leftNumericMatch = left.match(/^(\d+)[A-Za-z]$/);
  const rightNumericMatch = right.match(/^(\d+)[A-Za-z]$/);

  if (leftNumericMatch && rightNumericMatch) {
    const leftNumber = Number(leftNumericMatch[1]);
    const rightNumber = Number(rightNumericMatch[1]);

    if (leftNumber !== rightNumber) {
      return direction === "asc"
        ? leftNumber - rightNumber
        : rightNumber - leftNumber;
    }

    return direction === "asc"
      ? left.localeCompare(right)
      : right.localeCompare(left);
  }

  if (leftNumericMatch && !rightNumericMatch) {
    return direction === "asc" ? -1 : 1;
  }

  if (!leftNumericMatch && rightNumericMatch) {
    return direction === "asc" ? 1 : -1;
  }

  return direction === "asc"
    ? left.localeCompare(right)
    : right.localeCompare(left);
}

function getStatusLabel(value) {
  return value ? "Yes" : "No";
}

function parsePickupPhone(value) {
  const phoneNumber = parsePhoneNumberFromString(value, "US");

  if (!phoneNumber || !phoneNumber.isValid()) {
    return null;
  }

  return phoneNumber;
}

function formatPhoneDisplay(value) {
  const trimmedValue = String(value ?? "").trim();

  if (trimmedValue === "") {
    return "Not recorded";
  }

  const phoneNumber = parsePhoneNumberFromString(trimmedValue, "US");

  if (!phoneNumber || !phoneNumber.isValid()) {
    return trimmedValue;
  }

  return phoneNumber.country === "US"
    ? phoneNumber.formatNational()
    : phoneNumber.formatInternational();
}

function normalizeSearchText(value) {
  return String(value ?? "")
    .toLowerCase()
    .trim();
}

function normalizeSearchDigits(value) {
  return String(value ?? "").replace(/\D/g, "");
}

function normalizeEvent(event) {
  const normalizedId = Number(event.id);

  return {
    ...event,
    id: Number.isInteger(normalizedId) ? normalizedId : event.id,
    eventCode: event.eventCode ?? "",
    name: event.name ?? "",
    programName: event.programName ?? "",
    programCode: event.programCode ?? "",
    seasonName: event.seasonName ?? "",
    seasonCode: event.seasonCode ?? "",
    locationVenue: event.locationVenue ?? "",
    locationCity: event.locationCity ?? "",
    locationRegion: event.locationRegion ?? "",
    locationCountry: event.locationCountry ?? "",
  };
}

function formatEventDateRange(startAt, endAt) {
  if (!startAt && !endAt) {
    return "";
  }

  const formatter = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  const formattedStart = startAt ? formatter.format(new Date(startAt)) : "";
  const formattedEnd = endAt ? formatter.format(new Date(endAt)) : "";

  if (formattedStart && formattedEnd) {
    return `${formattedStart} - ${formattedEnd}`;
  }

  return formattedStart || formattedEnd;
}

function toCsvCell(value) {
  const normalizedValue =
    value === null || value === undefined ? "" : String(value);

  return `"${normalizedValue.replace(/"/g, '""')}"`;
}

function buildTeamsCsv(teams) {
  const headers = [
    "eventCode",
    "eventName",
    "teamNumber",
    "teamName",
    "organization",
    "contactNumber",
    "contactName",
    "preCheckedIn",
    "checkedIn",
    "wristbandsEstimated",
    "wristbandsActual",
    "parkingPass",
    "pickupName",
    "pickupPhoneNumber",
    "pickupNotes",
    "checkedInAt",
  ];
  const rows = teams.map((team) =>
    headers.map((header) => toCsvCell(team[header])),
  );

  return [
    headers.map(toCsvCell).join(","),
    ...rows.map((row) => row.join(",")),
  ].join("\n");
}

function trimCanvasElement(sourceCanvas) {
  if (!sourceCanvas) {
    return null;
  }

  const sourceContext = sourceCanvas.getContext("2d");

  if (!sourceContext) {
    return sourceCanvas;
  }

  const { width, height } = sourceCanvas;
  const { data } = sourceContext.getImageData(0, 0, width, height);
  let top = height;
  let left = width;
  let right = -1;
  let bottom = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const alpha = data[(y * width + x) * 4 + 3];

      if (alpha === 0) {
        continue;
      }

      top = Math.min(top, y);
      left = Math.min(left, x);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }

  if (right === -1 || bottom === -1) {
    return sourceCanvas;
  }

  const trimmedCanvas = document.createElement("canvas");
  const trimmedWidth = right - left + 1;
  const trimmedHeight = bottom - top + 1;

  trimmedCanvas.width = trimmedWidth;
  trimmedCanvas.height = trimmedHeight;

  const trimmedContext = trimmedCanvas.getContext("2d");

  if (!trimmedContext) {
    return sourceCanvas;
  }

  trimmedContext.drawImage(
    sourceCanvas,
    left,
    top,
    trimmedWidth,
    trimmedHeight,
    0,
    0,
    trimmedWidth,
    trimmedHeight,
  );

  return trimmedCanvas;
}

function getTrimmedSignatureCanvas(signaturePad) {
  return trimCanvasElement(signaturePad?.getCanvas?.());
}

const SignaturePadCanvas = forwardRef(function SignaturePadCanvas(
  { className = "", penColor = "#132231" },
  ref,
) {
  const canvasRef = useRef(null);
  const signaturePadInstanceRef = useRef(null);

  useImperativeHandle(ref, () => ({
    clear() {
      signaturePadInstanceRef.current?.clear();
    },
    isEmpty() {
      return signaturePadInstanceRef.current?.isEmpty() ?? true;
    },
    getCanvas() {
      return canvasRef.current;
    },
  }));

  useEffect(() => {
    const canvas = canvasRef.current;

    if (!canvas) {
      return undefined;
    }

    const signaturePad = new SignaturePad(canvas, {
      penColor,
      backgroundColor: "rgba(0,0,0,0)",
    });

    signaturePadInstanceRef.current = signaturePad;

    const resizeCanvas = () => {
      const nextCanvas = canvasRef.current;

      if (!nextCanvas) {
        return;
      }

      const ratio = Math.max(window.devicePixelRatio || 1, 1);
      nextCanvas.width = nextCanvas.offsetWidth * ratio;
      nextCanvas.height = nextCanvas.offsetHeight * ratio;

      const context = nextCanvas.getContext("2d");

      if (context) {
        context.scale(ratio, ratio);
      }

      signaturePad.clear();
    };

    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);

    return () => {
      window.removeEventListener("resize", resizeCanvas);
      signaturePad.off();
      signaturePadInstanceRef.current = null;
    };
  }, [penColor]);

  return <canvas ref={canvasRef} className={className} />;
});

function getVisiblePageNumbers(currentPage, totalPages) {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  const start = Math.max(1, currentPage - 2);
  const end = Math.min(totalPages, currentPage + 2);
  const pages = [];

  for (let page = start; page <= end; page += 1) {
    pages.push(page);
  }

  return pages;
}

function StatBadge({ value }) {
  return (
    <span
      className={`inline-flex min-w-14 items-center justify-center rounded-full px-3 py-1 text-sm font-semibold ${
        value
          ? "bg-emerald-100 text-emerald-800"
          : "bg-amber-100 text-amber-800"
      }`}
    >
      {getStatusLabel(value)}
    </span>
  );
}

function DetailCard({
  label,
  value,
  copyKey,
  copiedField,
  onCopy,
  compact = false,
}) {
  return (
    <article
      className={`rounded-xl border border-slate-200 bg-slate-50 ${
        compact ? "px-3 py-2.5" : "p-3"
      }`}
    >
      <p
        className={`font-bold uppercase tracking-[0.16em] text-slate-500 ${
          compact ? "text-[0.64rem]" : "text-[0.68rem]"
        }`}
      >
        {label}
      </p>
      <div
        className={`flex items-start justify-between gap-2 ${
          compact ? "mt-1.5" : "mt-2"
        }`}
      >
        <p
          className={`min-w-0 flex-1 truncate text-slate-800 ${
            compact ? "text-[0.95rem] font-semibold" : "text-sm font-medium"
          }`}
        >
          {value}
        </p>
        <button
          type="button"
          className={`shrink-0 rounded-full border border-slate-300 bg-white font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-slate-100 ${
            compact ? "px-2.5 py-0.5 text-[0.7rem]" : "px-2.5 py-1 text-xs"
          }`}
          onClick={(event) => onCopy(event, copyKey, value)}
        >
          {copiedField === copyKey ? "Copied" : "Copy"}
        </button>
      </div>
    </article>
  );
}

function SimpleField({ label, value }) {
  return (
    <article className="rounded-xl border border-slate-200 bg-white px-3 py-2.5">
      <p className="text-[0.68rem] font-bold uppercase tracking-[0.16em] text-slate-500">
        {label}
      </p>
      <p className="mt-1 text-sm font-semibold text-slate-900">{value}</p>
    </article>
  );
}

function TeamProgressField({ preCheckedIn, checkedIn, className = "" }) {
  const progress = checkedIn ? 100 : preCheckedIn ? 50 : 0;
  const progressLabel = checkedIn
    ? "Fully checked in"
    : preCheckedIn
      ? "Pre-checked in"
      : "Not started";

  return (
    <article
      className={`rounded-xl border border-slate-200 bg-white px-3 py-2.5 sm:col-span-2 lg:col-span-2 ${className}`}
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-[0.68rem] font-bold uppercase tracking-[0.16em] text-slate-500">
          Check-In Progress
        </p>
        <p className="text-xs font-semibold text-slate-500">{progress}%</p>
      </div>
      <div className="mt-2 h-3 overflow-hidden rounded-full bg-slate-200">
        <div
          className={`h-full rounded-full transition-all ${
            checkedIn
              ? "bg-emerald-500"
              : preCheckedIn
                ? "bg-amber-400"
                : "bg-slate-300"
          }`}
          style={{ width: `${progress}%` }}
        />
      </div>
      <div className="mt-2 flex items-center justify-between gap-3 text-xs font-semibold">
        <span className={preCheckedIn ? "text-amber-700" : "text-slate-400"}>
          Pre-checked
        </span>
        <span className={checkedIn ? "text-emerald-700" : "text-slate-400"}>
          Fully checked
        </span>
      </div>
    </article>
  );
}

function CopyableSimpleField({ label, value, copyKey, copiedField, onCopy }) {
  return (
    <article className="rounded-xl border border-slate-200 bg-white px-3 py-2.5">
      <p className="text-[0.68rem] font-bold uppercase tracking-[0.16em] text-slate-500">
        {label}
      </p>
      <div className="mt-1 flex items-start justify-between gap-2">
        <p className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-900">
          {value}
        </p>
        <button
          type="button"
          className="shrink-0 rounded-full border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-slate-100"
          onClick={(event) => onCopy(event, copyKey, value)}
        >
          {copiedField === copyKey ? "Copied" : "Copy"}
        </button>
      </div>
    </article>
  );
}

function copyTextWithFallback(value) {
  const textToCopy = String(value ?? "");

  if (
    typeof navigator !== "undefined" &&
    navigator.clipboard &&
    typeof navigator.clipboard.writeText === "function"
  ) {
    return navigator.clipboard.writeText(textToCopy);
  }

  return new Promise((resolve, reject) => {
    if (typeof document === "undefined") {
      reject(new Error("Clipboard is not available."));
      return;
    }

    const helperTextArea = document.createElement("textarea");
    helperTextArea.value = textToCopy;
    helperTextArea.setAttribute("readonly", "");
    helperTextArea.style.position = "fixed";
    helperTextArea.style.opacity = "0";
    helperTextArea.style.pointerEvents = "none";

    document.body.appendChild(helperTextArea);
    helperTextArea.focus();
    helperTextArea.select();

    try {
      const wasCopied = document.execCommand("copy");
      document.body.removeChild(helperTextArea);

      if (!wasCopied) {
        reject(new Error("Copy command failed."));
        return;
      }

      resolve();
    } catch (error) {
      document.body.removeChild(helperTextArea);
      reject(error);
    }
  });
}

function StyledSelect({ value, onChange, children, className = "" }) {
  return (
    <div
      className={`relative inline-flex items-center rounded-xl border border-slate-300 bg-white shadow-sm transition focus-within:border-slate-400 focus-within:ring-2 focus-within:ring-slate-200 ${className}`}
    >
      <select
        value={value}
        onChange={onChange}
        className="h-10 appearance-none rounded-xl bg-transparent pl-3 pr-9 text-sm font-medium text-slate-800 outline-none"
      >
        {children}
      </select>
      <svg
        aria-hidden="true"
        viewBox="0 0 20 20"
        fill="none"
        className="pointer-events-none absolute right-3 h-4 w-4 text-slate-500"
      >
        <path
          d="M5 7.5L10 12.5L15 7.5"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

function BreakdownTooltip({ items, align = "left", isOpen = false }) {
  if (!items || items.length === 0) {
    return null;
  }

  return (
    <div
      className={`absolute top-full z-20 mt-2 w-64 rounded-2xl border border-slate-200 bg-white p-3 text-left shadow-[0_18px_50px_rgba(15,23,42,0.18)] transition duration-150 ${
        isOpen
          ? "pointer-events-auto opacity-100"
          : "pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100"
      } ${
        align === "right" ? "right-0" : "left-0"
      }`}
    >
      <p className="text-[0.68rem] font-bold uppercase tracking-[0.16em] text-slate-500">
        Event Breakdown
      </p>
      <div className="mt-2 grid gap-2">
        {items.map((item) => (
          <div
            key={item.key}
            className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2"
          >
            <span className="truncate text-sm font-semibold text-slate-700">
              {item.label}
            </span>
            <span className="text-sm font-black text-slate-950">
              {item.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function CombinedMetricCard({
  tooltipKey,
  title,
  value,
  preview,
  tooltipItems,
  className = "",
  activeTooltipKey,
  onToggleTooltip,
}) {
  return (
    <article
      className={`group relative cursor-pointer rounded-2xl px-5 py-4 text-white ${className}`}
      onClick={() => onToggleTooltip(tooltipKey)}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onToggleTooltip(tooltipKey);
        }
      }}
    >
      <p className="text-xs font-bold uppercase tracking-[0.16em] text-white/70">
        {title}
      </p>
      <strong className="mt-3 block text-3xl font-black">{value}</strong>
      <p className="mt-2 truncate text-sm font-semibold text-white/75">
        {preview}
      </p>
      <BreakdownTooltip
        items={tooltipItems}
        isOpen={activeTooltipKey === tooltipKey}
      />
    </article>
  );
}

function CombinedLegendRow({
  color,
  label,
  value,
  tooltipItems,
}) {
  return (
    <div className="group relative flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3">
      <div className="flex items-center gap-3">
        <span className="h-3 w-3 rounded-full" style={{ backgroundColor: color }} />
        <span className="font-semibold text-slate-700">{label}</span>
      </div>
      <span className="font-bold text-slate-950">{value}</span>
      <BreakdownTooltip items={tooltipItems} align="right" />
    </div>
  );
}

function CombinedTotalRow({ label, value, tooltipItems }) {
  return (
    <div className="group relative flex items-baseline justify-between gap-4 rounded-xl bg-slate-50 px-3 py-2">
      <p className="text-sm font-semibold text-slate-700">{label}</p>
      <p className="text-xl font-black text-slate-950">{value}</p>
      <BreakdownTooltip items={tooltipItems} align="right" />
    </div>
  );
}

function AppScreen() {
  const navigate = useNavigate();
  const { eventId: eventIdParam, combinedId: combinedIdParam } = useParams();
  const [events, setEvents] = useState([]);
  const [isLoadingEvents, setIsLoadingEvents] = useState(true);
  const [eventsError, setEventsError] = useState("");
  const [eventCodeInput, setEventCodeInput] = useState("");
  const [eventImportError, setEventImportError] = useState("");
  const [isImportingEvent, setIsImportingEvent] = useState(false);
  const [combinedDashboards, setCombinedDashboards] = useState(() =>
    loadCombinedDashboards(),
  );
  const [isCombinedModalOpen, setIsCombinedModalOpen] = useState(false);
  const [combinedDashboardNameInput, setCombinedDashboardNameInput] =
    useState("");
  const [combinedDashboardEventIds, setCombinedDashboardEventIds] = useState(
    [],
  );
  const [combinedDashboardError, setCombinedDashboardError] = useState("");
  const [teams, setTeams] = useState([]);
  const [isLoadingTeams, setIsLoadingTeams] = useState(true);
  const [teamsError, setTeamsError] = useState("");
  const [combinedTeamsByEventId, setCombinedTeamsByEventId] = useState({});
  const [isLoadingCombinedTeams, setIsLoadingCombinedTeams] = useState(false);
  const [combinedTeamsError, setCombinedTeamsError] = useState("");
  const [statusFilters, setStatusFilters] = useState({
    preChecked: "any",
    checkedIn: "false",
  });
  const [searchTerm, setSearchTerm] = useState("");
  const [sortConfig, setSortConfig] = useState({
    key: "teamNumber",
    direction: "asc",
  });
  const [pageSize, setPageSize] = useState(10);
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedTeamId, setSelectedTeamId] = useState(null);
  const [signatureNotice, setSignatureNotice] = useState("");
  const [signatureNoticeTone, setSignatureNoticeTone] = useState("info");
  const [copiedField, setCopiedField] = useState("");
  const [checkInStep, setCheckInStep] = useState("wristbands");
  const [checkedInPanel, setCheckedInPanel] = useState("signature");
  const [wristbandsActualInput, setWristbandsActualInput] = useState("");
  const [parkingPassInput, setParkingPassInput] = useState(false);
  const [wristbandsError, setWristbandsError] = useState("");
  const [pickupNotes, setPickupNotes] = useState("");
  const [pickupName, setPickupName] = useState("");
  const [pickupPhone, setPickupPhone] = useState("");
  const [pickupNameError, setPickupNameError] = useState("");
  const [pickupPhoneError, setPickupPhoneError] = useState("");
  const [isSavingTeam, setIsSavingTeam] = useState(false);
  const [pickupResult, setPickupResult] = useState(null);
  const [pickupResultMessage, setPickupResultMessage] = useState("");
  const [pickupSummary, setPickupSummary] = useState({
    wristbandsActual: 0,
    parkingPass: false,
  });
  const [activeCombinedTooltipKey, setActiveCombinedTooltipKey] = useState("");
  const signaturePadRef = useRef(null);
  const checkedInPanelTouchStartXRef = useRef(null);
  const selectedEventId =
    eventIdParam && /^\d+$/.test(eventIdParam) ? Number(eventIdParam) : null;
  const selectedCombinedId =
    typeof combinedIdParam === "string" && combinedIdParam.trim() !== ""
      ? combinedIdParam
      : null;
  const selectedCombinedDashboard =
    selectedCombinedId === null
      ? null
      : combinedDashboards.find((dashboard) => dashboard.id === selectedCombinedId) ??
        null;
  const isCombinedView = selectedCombinedDashboard !== null;

  const selectedTeam =
    selectedTeamId === null
      ? null
      : (
          [
            ...teams,
            ...Object.values(combinedTeamsByEventId).flat(),
          ].find((team) => team.id === selectedTeamId) ?? null
        );
  const selectedEvent =
    selectedEventId === null
      ? null
      : (events.find((event) => event.id === selectedEventId) ?? null);
  const combinedEventEntries = useMemo(
    () =>
      selectedCombinedDashboard
        ? selectedCombinedDashboard.eventIds
            .map((eventId) => events.find((event) => event.id === eventId))
            .filter(Boolean)
        : [],
    [events, selectedCombinedDashboard],
  );
  const activeTeams = useMemo(() => {
    if (!isCombinedView) {
      return teams;
    }

    return combinedEventEntries.flatMap((event) =>
      (combinedTeamsByEventId[event.id] ?? []).map((team) => ({
        ...team,
        eventCode: event.eventCode,
        eventName: event.name,
        eventId: event.id,
      })),
    );
  }, [combinedEventEntries, combinedTeamsByEventId, isCombinedView, teams]);
  const filteredTeams = useMemo(() => {
    const normalizedSearchTerm = normalizeSearchText(searchTerm);
    const normalizedDigitSearch = normalizeSearchDigits(searchTerm);

    return activeTeams.filter((team) => {
      const matchesPreChecked =
        statusFilters.preChecked === "any" ||
        String(team.preCheckedIn) === statusFilters.preChecked;
      const matchesCheckedIn =
        statusFilters.checkedIn === "any" ||
        String(team.checkedIn) === statusFilters.checkedIn;
      const matchesSearch = isCombinedView
        ? normalizedSearchTerm === "" ||
          normalizeSearchText(team.teamNumber).includes(normalizedSearchTerm) ||
          (normalizedDigitSearch !== "" &&
            normalizeSearchDigits(team.teamNumber).includes(
              normalizedDigitSearch,
            ))
        : normalizedSearchTerm === "" ||
          [
            team.teamNumber,
            team.teamName,
            team.organization,
            team.contactName,
            team.contactNumber,
          ].some((value) =>
            normalizeSearchText(value).includes(normalizedSearchTerm),
          ) ||
          (normalizedDigitSearch !== "" &&
            [team.teamNumber, team.contactNumber].some((value) =>
              normalizeSearchDigits(value).includes(normalizedDigitSearch),
            ));

      return matchesPreChecked && matchesCheckedIn && matchesSearch;
    });
  }, [activeTeams, isCombinedView, searchTerm, statusFilters]);

  const sortedTeams = useMemo(
    () =>
      [...filteredTeams].sort((left, right) => {
        if (sortConfig.key === "teamNumber") {
          return compareTeamNumbers(
            left.teamNumber,
            right.teamNumber,
            sortConfig.direction,
          );
        }

        return compareValues(
          left[sortConfig.key],
          right[sortConfig.key],
          sortConfig.direction,
        );
      }),
    [filteredTeams, sortConfig],
  );
  const currentColumns = useMemo(
    () =>
      isCombinedView
        ? [{ key: "eventCode", label: "Event" }, ...columns]
        : columns,
    [isCombinedView],
  );

  const effectivePageSize =
    pageSize === "all" ? sortedTeams.length || 1 : Number(pageSize);
  const totalPages = Math.max(
    1,
    Math.ceil(sortedTeams.length / effectivePageSize),
  );
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const startIndex = (safeCurrentPage - 1) * effectivePageSize;
  const paginatedTeams =
    pageSize === "all"
      ? sortedTeams
      : sortedTeams.slice(startIndex, startIndex + effectivePageSize);
  const visiblePageNumbers =
    pageSize === "all"
      ? [1]
      : getVisiblePageNumbers(safeCurrentPage, totalPages);
  const selectedTeamWristbandsSummary =
    selectedTeam === null
      ? ""
      : !selectedTeam.checkedIn &&
          wristbandsActualInput !== "" &&
          checkInStep !== "wristbands"
        ? wristbandsActualInput
        : selectedTeam.checkedIn && selectedTeam.wristbandsActual !== null
        ? String(selectedTeam.wristbandsActual)
        : selectedTeam.preCheckedIn
          ? `${selectedTeam.wristbandsEstimated} (est)`
          : "";
  const selectedTeamParkingSummary =
    selectedTeam === null || !selectedTeam.checkedIn
      ? ""
      : getStatusLabel(selectedTeam.parkingPass);

  async function fetchEvents({ showLoading = true } = {}) {
    if (showLoading) {
      setIsLoadingEvents(true);
    }

    setEventsError("");

    try {
      const response = await fetch(createApiUrl("/api/events"));
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(
          payload.error || payload.details || "Failed to load events.",
        );
      }

      const normalizedEvents = payload.map(normalizeEvent);
      setEvents(normalizedEvents);
    } catch (error) {
      setEvents([]);
      setEventsError(error.message || "Failed to load events.");
    } finally {
      if (showLoading) {
        setIsLoadingEvents(false);
      }
    }
  }

  async function fetchTeamsForEvent(eventId, { showLoading = true } = {}) {
    if (eventId === null) {
      setTeams([]);
      setTeamsError("");
      setIsLoadingTeams(false);
      return;
    }

    if (showLoading) {
      setIsLoadingTeams(true);
    }

    setTeamsError("");

    try {
      const response = await fetch(
        createApiUrl(`/api/events/${eventId}/teams`),
      );
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(
          payload.error || payload.details || "Failed to load teams.",
        );
      }

      setTeams(payload.map(normalizeTeam));
    } catch (error) {
      setTeams([]);
      setTeamsError(error.message || "Failed to load teams.");
    } finally {
      if (showLoading) {
        setIsLoadingTeams(false);
      }
    }
  }

  const totalTeams = activeTeams.length;
  const preCheckedCount = activeTeams.filter((team) => team.preCheckedIn).length;
  const fullyCheckedCount = activeTeams.filter((team) => team.checkedIn).length;
  const preCheckedOnlyCount = preCheckedCount - fullyCheckedCount;
  const notPreCheckedCount = totalTeams - preCheckedCount;
  const estimatedWristbandsTotal = activeTeams.reduce(
    (total, team) => total + Number(team.wristbandsEstimated ?? 0),
    0,
  );
  const actualWristbandsDistributedTotal = activeTeams.reduce(
    (total, team) =>
      total + (team.checkedIn ? Number(team.wristbandsActual ?? 0) : 0),
    0,
  );
  const parkingPassesDistributedTotal = activeTeams.reduce(
    (total, team) => total + (team.checkedIn && team.parkingPass ? 1 : 0),
    0,
  );
  const combinedBreakdowns = useMemo(() => {
    if (!isCombinedView) {
      return null;
    }

    return combinedEventEntries.map((event) => {
      const eventTeams = combinedTeamsByEventId[event.id] ?? [];
      const eventPreChecked = eventTeams.filter((team) => team.preCheckedIn).length;
      const eventFullyChecked = eventTeams.filter((team) => team.checkedIn).length;
      const eventPreOnly = eventPreChecked - eventFullyChecked;
      const eventPending = eventTeams.length - eventPreChecked;

      return {
        eventId: event.id,
        eventCode: event.eventCode,
        totalTeams: eventTeams.length,
        preChecked: eventPreChecked,
        fullyChecked: eventFullyChecked,
        preCheckedOnly: eventPreOnly,
        notPreChecked: eventPending,
        estimatedWristbands: eventTeams.reduce(
          (total, team) => total + Number(team.wristbandsEstimated ?? 0),
          0,
        ),
        actualWristbands: eventTeams.reduce(
          (total, team) =>
            total + (team.checkedIn ? Number(team.wristbandsActual ?? 0) : 0),
          0,
        ),
        parkingPasses: eventTeams.reduce(
          (total, team) => total + (team.checkedIn && team.parkingPass ? 1 : 0),
          0,
        ),
      };
    });
  }, [combinedEventEntries, combinedTeamsByEventId, isCombinedView]);
  const combinedMetricCards = useMemo(() => {
    if (!combinedBreakdowns) {
      return null;
    }

    return [
      {
        tooltipKey: "combined-total-teams",
        title: "Total Teams",
        value: totalTeams,
        preview: combinedBreakdowns.map((item) => item.totalTeams).join(" / "),
        tooltipItems: combinedBreakdowns.map((item) => ({
          key: `teams-${item.eventId}`,
          label: item.eventCode,
          value: item.totalTeams,
        })),
        className: "bg-slate-950",
      },
      {
        tooltipKey: "combined-pre-checked",
        title: "Pre-Checked",
        value: preCheckedCount,
        preview: combinedBreakdowns.map((item) => item.preChecked).join(" / "),
        tooltipItems: combinedBreakdowns.map((item) => ({
          key: `pre-${item.eventId}`,
          label: item.eventCode,
          value: item.preChecked,
        })),
        className: "bg-amber-500",
      },
      {
        tooltipKey: "combined-fully-checked",
        title: "Fully Checked",
        value: fullyCheckedCount,
        preview: combinedBreakdowns.map((item) => item.fullyChecked).join(" / "),
        tooltipItems: combinedBreakdowns.map((item) => ({
          key: `full-${item.eventId}`,
          label: item.eventCode,
          value: item.fullyChecked,
        })),
        className: "bg-emerald-600",
      },
    ];
  }, [combinedBreakdowns, fullyCheckedCount, preCheckedCount, totalTeams]);

  const chartTotal = totalTeams || 1;
  const pieStyle = useMemo(() => {
    if (!isCombinedView || !combinedBreakdowns || totalTeams === 0) {
      return {
        background: `conic-gradient(
          #0f172a 0deg ${(fullyCheckedCount / chartTotal) * 360}deg,
          #475569 ${(fullyCheckedCount / chartTotal) * 360}deg ${
            ((fullyCheckedCount + preCheckedOnlyCount) / chartTotal) * 360
          }deg,
          #cbd5e1 ${((fullyCheckedCount + preCheckedOnlyCount) / chartTotal) * 360}deg 360deg
        )`,
      };
    }

    const segments = [];
    const pushSegments = (statusKey, valueKey) => {
      const palette = combinedStatusPalettes[statusKey];
      combinedBreakdowns.forEach((item, index) => {
        const value = item[valueKey];
        if (value > 0) {
          segments.push({
            color: palette[index % palette.length],
            value,
          });
        }
      });
    };

    pushSegments("checkedIn", "fullyChecked");
    pushSegments("preCheckedOnly", "preCheckedOnly");
    pushSegments("notPreChecked", "notPreChecked");

    if (segments.length === 0) {
      return { background: "#e2e8f0" };
    }

    let currentDegrees = 0;
    const gradientParts = segments.map((segment) => {
      const nextDegrees = currentDegrees + (segment.value / totalTeams) * 360;
      const part = `${segment.color} ${currentDegrees}deg ${nextDegrees}deg`;
      currentDegrees = nextDegrees;
      return part;
    });

    return {
      background: `conic-gradient(${gradientParts.join(", ")})`,
    };
  }, [
    chartTotal,
    combinedBreakdowns,
    fullyCheckedCount,
    isCombinedView,
    preCheckedOnlyCount,
    totalTeams,
  ]);

  useEffect(() => {
    fetchEvents({ showLoading: true }).catch(() => {});
  }, []);

  useEffect(() => {
    saveCombinedDashboards(combinedDashboards);
  }, [combinedDashboards]);

  useEffect(() => {
    fetchTeamsForEvent(selectedEventId, { showLoading: true }).catch(() => {});
  }, [selectedEventId]);

  useEffect(() => {
    if (!isCombinedView) {
      setCombinedTeamsByEventId({});
      setCombinedTeamsError("");
      setIsLoadingCombinedTeams(false);
      return;
    }

    let isCancelled = false;

    const fetchCombinedTeams = async ({ showLoading = true } = {}) => {
      if (showLoading) {
        setIsLoadingCombinedTeams(true);
      }

      setCombinedTeamsError("");

      try {
        const entries = await Promise.all(
          selectedCombinedDashboard.eventIds.map(async (eventId) => {
            const response = await fetch(
              createApiUrl(`/api/events/${eventId}/teams`),
            );
            const payload = await response.json();

            if (!response.ok) {
              throw new Error(
                payload.error || payload.details || "Failed to load combined teams.",
              );
            }

            return [eventId, payload.map(normalizeTeam)];
          }),
        );

        if (!isCancelled) {
          setCombinedTeamsByEventId(Object.fromEntries(entries));
        }
      } catch (error) {
        if (!isCancelled) {
          setCombinedTeamsByEventId({});
          setCombinedTeamsError(
            error.message || "Failed to load combined teams.",
          );
        }
      } finally {
        if (!isCancelled && showLoading) {
          setIsLoadingCombinedTeams(false);
        }
      }
    };

    fetchCombinedTeams({ showLoading: true }).catch(() => {});

    const intervalId = window.setInterval(() => {
      fetchEvents({ showLoading: false }).catch(() => {});
      fetchCombinedTeams({ showLoading: false }).catch(() => {});
    }, 30 * 1000);

    return () => {
      isCancelled = true;
      window.clearInterval(intervalId);
    };
  }, [isCombinedView, selectedCombinedDashboard]);

  useEffect(() => {
    if (selectedEventId === null || isCombinedView) {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      fetchEvents({ showLoading: false }).catch(() => {});
      fetchTeamsForEvent(selectedEventId, { showLoading: false }).catch(
        () => {},
      );
    }, 30 * 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [isCombinedView, selectedEventId]);

  useEffect(() => {
    setSelectedTeamId(null);
    setCurrentPage(1);
  }, [selectedCombinedId, selectedEventId]);

  useEffect(() => {
    setActiveCombinedTooltipKey("");
  }, [selectedCombinedId, selectedEventId]);

  useEffect(() => {
    if (!selectedTeam) {
      return undefined;
    }

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        setSelectedTeamId(null);
        setSignatureNotice("");
        setSignatureNoticeTone("info");
        setCopiedField("");
        signaturePadRef.current?.clear();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [selectedTeam]);

  useEffect(() => {
    if (selectedTeam) {
      signaturePadRef.current?.clear();
      setSignatureNotice("");
      setSignatureNoticeTone("info");
      setCopiedField("");
      setCheckedInPanel("signature");
      setCheckInStep("wristbands");
      setPickupResult(null);
      setPickupResultMessage("");
      setWristbandsActualInput(
        selectedTeam.wristbandsActual === null
          ? ""
          : String(selectedTeam.wristbandsActual),
      );
      setParkingPassInput(selectedTeam.parkingPass);
      setPickupSummary({
        wristbandsActual: selectedTeam.wristbandsActual ?? 0,
        parkingPass: selectedTeam.parkingPass,
      });
      setWristbandsError("");
      setPickupNotes(selectedTeam.pickupNotes ?? "");
      setPickupName("");
      setPickupPhone("");
      setPickupNameError("");
      setPickupPhoneError("");
    }
  }, [selectedTeam?.id]);

  useEffect(() => {
    if (!isCombinedModalOpen) {
      return undefined;
    }

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        closeCombinedDashboardModal();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isCombinedModalOpen]);

  function handleSort(columnKey) {
    setCurrentPage(1);
    setSortConfig((current) => ({
      key: columnKey,
      direction:
        current.key === columnKey && current.direction === "asc"
          ? "desc"
          : "asc",
    }));
  }

  function handlePageSizeChange(event) {
    const value =
      event.target.value === "all" ? "all" : Number(event.target.value);
    setPageSize(value);
    setCurrentPage(1);
  }

  function handleStatusFilterChange(filterKey, value) {
    setStatusFilters((current) => ({
      ...current,
      [filterKey]: value,
    }));
    setCurrentPage(1);
  }

  function handleSearchTermChange(event) {
    setSearchTerm(event.target.value);
    setCurrentPage(1);
  }

  function handleExportCsv() {
    const csvContent = buildTeamsCsv(activeTeams);
    const csvBlob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const downloadUrl = URL.createObjectURL(csvBlob);
    const downloadLink = document.createElement("a");

    downloadLink.href = downloadUrl;
    downloadLink.download = isCombinedView
      ? `${selectedCombinedDashboard.name || "combined"}-teams.csv`
      : selectedEvent
        ? `${selectedEvent.eventCode || "event"}-teams.csv`
        : "worlds-check-in-teams.csv";
    document.body.appendChild(downloadLink);
    downloadLink.click();
    document.body.removeChild(downloadLink);
    URL.revokeObjectURL(downloadUrl);
  }

  async function handleImportEvent(event) {
    event.preventDefault();

    const trimmedEventCode = eventCodeInput.trim().toUpperCase();

    if (trimmedEventCode === "") {
      setEventImportError("Enter an event code to import.");
      return;
    }

    setIsImportingEvent(true);
    setEventImportError("");

    try {
      const response = await fetch(createApiUrl("/api/events/import"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          eventCode: trimmedEventCode,
        }),
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(
          payload.details || payload.error || "Failed to import event.",
        );
      }

      const importedEvent = normalizeEvent(payload.event);

      setEvents((currentEvents) => {
        const nextEvents = [
          importedEvent,
          ...currentEvents.filter((current) => current.id !== importedEvent.id),
        ];

        return nextEvents.sort((left, right) =>
          String(right.startAt ?? "").localeCompare(String(left.startAt ?? "")),
        );
      });
      navigate(`/events/${importedEvent.id}`);
      setEventCodeInput("");
      setSelectedTeamId(null);
    } catch (error) {
      setEventImportError(error.message || "Failed to import event.");
    } finally {
      setIsImportingEvent(false);
    }
  }

  function openCombinedDashboardModal() {
    setCombinedDashboardNameInput("");
    setCombinedDashboardEventIds([]);
    setCombinedDashboardError("");
    setIsCombinedModalOpen(true);
  }

  function closeCombinedDashboardModal() {
    setIsCombinedModalOpen(false);
    setCombinedDashboardError("");
  }

  function handleCombinedEventToggle(eventId) {
    setCombinedDashboardEventIds((current) =>
      current.includes(eventId)
        ? current.filter((currentEventId) => currentEventId !== eventId)
        : [...current, eventId],
    );
  }

  function handleCreateCombinedDashboard(event) {
    event.preventDefault();

    const trimmedName = combinedDashboardNameInput.trim();

    if (trimmedName === "") {
      setCombinedDashboardError("Enter a name for this combined dashboard.");
      return;
    }

    if (combinedDashboardEventIds.length === 0) {
      setCombinedDashboardError("Select at least one imported event.");
      return;
    }

    const nextDashboard = {
      id: createCombinedDashboardId(),
      name: trimmedName,
      eventIds: [...combinedDashboardEventIds].sort((left, right) => left - right),
    };

    setCombinedDashboards((current) => [...current, nextDashboard]);
    closeCombinedDashboardModal();
    navigate(`/combined/${nextDashboard.id}`);
  }

  function handleToggleCombinedTooltip(tooltipKey) {
    setActiveCombinedTooltipKey((current) =>
      current === tooltipKey ? "" : tooltipKey,
    );
  }

  function handleRemoveCombinedDashboard(event, dashboardId) {
    event.stopPropagation();
    event.preventDefault();

    setCombinedDashboards((current) =>
      current.filter((dashboard) => dashboard.id !== dashboardId),
    );

    if (selectedCombinedId === dashboardId) {
      navigate("/");
    }
  }

  const combinedDashboardModal = isCombinedModalOpen ? (
    <div
      className="fixed inset-0 z-40 grid place-items-center bg-slate-950/40 px-4 py-6 backdrop-blur-sm"
      onClick={closeCombinedDashboardModal}
    >
      <section
        className="w-full max-w-3xl rounded-[28px] border border-slate-200 bg-white p-6 shadow-[0_30px_120px_rgba(15,23,42,0.25)]"
        onClick={(event) => event.stopPropagation()}
        aria-modal="true"
        role="dialog"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">
              Combined Dashboard
            </p>
            <h2 className="mt-2 text-3xl font-black tracking-tight text-slate-950">
              Create a combined team check-in dashboard
            </h2>
            <p className="mt-3 max-w-2xl text-sm font-medium leading-6 text-slate-600">
              Choose imported events to combine into one saved dashboard. This stays stored in this browser.
            </p>
          </div>
          <button
            type="button"
            className="rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
            onClick={closeCombinedDashboardModal}
          >
            Close
          </button>
        </div>

        <form className="mt-5" onSubmit={handleCreateCombinedDashboard}>
          <label className="grid gap-2">
            <span className="text-sm font-semibold text-slate-700">
              Dashboard name
            </span>
            <input
              type="text"
              value={combinedDashboardNameInput}
              onChange={(event) => setCombinedDashboardNameInput(event.target.value)}
              className="h-12 rounded-2xl border border-slate-300 bg-white px-4 text-base font-semibold text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
              placeholder="Worlds Combined Dashboard"
            />
          </label>

          <div className="mt-5">
            <p className="text-sm font-semibold text-slate-700">
              Select imported events
            </p>
            {events.length === 0 ? (
              <div className="mt-3 rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-5 py-10 text-center text-sm font-medium text-slate-500">
                Import events first, then create a combined dashboard.
              </div>
            ) : (
              <div className="mt-3 grid max-h-[45dvh] gap-3 overflow-y-auto pr-1">
                {events.map((event) => {
                  const isSelected = combinedDashboardEventIds.includes(event.id);

                  return (
                    <button
                      key={event.id}
                      type="button"
                      className={`rounded-[22px] border px-4 py-4 text-left transition ${
                        isSelected
                          ? "border-slate-900 bg-slate-900 text-white"
                          : "border-slate-200 bg-slate-50 text-slate-900 hover:border-slate-300 hover:bg-slate-100"
                      }`}
                      onClick={() => handleCombinedEventToggle(event.id)}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className={`text-xs font-bold uppercase tracking-[0.18em] ${isSelected ? "text-white/70" : "text-slate-500"}`}>
                            {event.eventCode}
                          </p>
                          <h3 className="mt-2 truncate text-lg font-black">
                            {event.name}
                          </h3>
                        </div>
                        <span className={`rounded-full px-3 py-1 text-xs font-bold ${isSelected ? "bg-white text-slate-900" : "bg-slate-200 text-slate-700"}`}>
                          {isSelected ? "Selected" : "Select"}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <p className={`mt-4 min-h-5 text-sm font-semibold ${combinedDashboardError ? "text-red-600" : "text-slate-500"}`}>
            {combinedDashboardError || `${combinedDashboardEventIds.length} events selected`}
          </p>

          <div className="mt-4 flex justify-end">
            <button
              type="submit"
              className="rounded-full bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800"
            >
              Save Combined Dashboard
            </button>
          </div>
        </form>
      </section>
    </div>
  ) : null;

  function closeTeamModal() {
    const shouldResetSearch =
      checkInStep === "result" && pickupResult === "success";

    setSelectedTeamId(null);
    setSignatureNotice("");
    setSignatureNoticeTone("info");
    setCopiedField("");
    setCheckedInPanel("signature");
    setPickupResult(null);
    setPickupResultMessage("");
    signaturePadRef.current?.clear();

    if (shouldResetSearch) {
      setSearchTerm("");
      setCurrentPage(1);
    }
  }

  function handleCheckedInPanelTouchStart(event) {
    checkedInPanelTouchStartXRef.current =
      event.changedTouches[0]?.clientX ?? null;
  }

  function handleCheckedInPanelTouchEnd(event) {
    const startX = checkedInPanelTouchStartXRef.current;
    const endX = event.changedTouches[0]?.clientX ?? null;

    checkedInPanelTouchStartXRef.current = null;

    if (startX === null || endX === null) {
      return;
    }

    const deltaX = endX - startX;

    if (Math.abs(deltaX) < 40) {
      return;
    }

    setCheckedInPanel(deltaX < 0 ? "notes" : "signature");
  }

  async function handleCopy(event, label, value) {
    event.stopPropagation();
    event.preventDefault();

    try {
      await copyTextWithFallback(value);
      setCopiedField(label);
      window.setTimeout(() => {
        setCopiedField((current) => (current === label ? "" : current));
      }, 1500);
    } catch (_error) {
      setCopiedField("");
    }
  }

  function handleClearSignature() {
    signaturePadRef.current?.clear();
    setSignatureNotice("Canvas cleared.");
    setSignatureNoticeTone("info");
    window.setTimeout(() => {
      setSignatureNotice((current) => {
        if (current === "Canvas cleared.") {
          setSignatureNoticeTone("info");
          return "";
        }

        return current;
      });
    }, 5000);
  }

  function handlePickupNameChange(event) {
    const value = event.target.value.replace(/[^A-Za-z\s]/g, "");
    setPickupName(value);
    setPickupNameError(value.trim() === "" ? "Pickup name is required." : "");
  }

  function handlePickupPhoneChange(event) {
    const value = event.target.value;
    const parsedPhone = parsePickupPhone(value);

    setPickupPhone(value);
    setPickupPhoneError(
      value.trim() !== "" && !parsedPhone ? "Enter a valid phone number." : "",
    );
  }

  function handleNextToAcknowledgement() {
    if (!selectedTeam?.preCheckedIn) {
      return;
    }

    const actualWristbands = Number(wristbandsActualInput);

    if (
      wristbandsActualInput === "" ||
      !Number.isInteger(actualWristbands) ||
      actualWristbands < 0
    ) {
      setWristbandsError("Enter a valid number of wristbands.");
      return;
    }

    if (actualWristbands > 13) {
      setWristbandsError(
        "If more than 13 wristbands are needed, pick up extras at spectator check-in.",
      );
      return;
    }

    setWristbandsError("");
    setCheckInStep("acknowledgement");
  }

  async function handleSaveSignature() {
    if (!selectedTeam) {
      return;
    }

    const trimmedPickupName = pickupName.trim();

    if (trimmedPickupName === "") {
      setPickupNameError("Pickup name is required.");
      setSignatureNoticeTone("error");
      return;
    }

    const parsedPickupPhone = parsePickupPhone(pickupPhone);

    if (!parsedPickupPhone) {
      setPickupPhoneError("Enter a valid phone number.");
      setSignatureNoticeTone("error");
      return;
    }

    if (!signaturePadRef.current || signaturePadRef.current.isEmpty()) {
      setSignatureNotice("Signature is required to confirm pickup.");
      setSignatureNoticeTone("error");
      return;
    }

    const signatureCanvas = getTrimmedSignatureCanvas(signaturePadRef.current);

    if (!signatureCanvas) {
      setSignatureNotice("Failed to prepare the signature image.");
      setSignatureNoticeTone("error");
      return;
    }

    const signaturePreview = signatureCanvas.toDataURL("image/png");

    setIsSavingTeam(true);
    setSignatureNotice("");
    setSignatureNoticeTone("info");
    setPickupResult(null);
    setPickupResultMessage("");

    try {
      const signatureBlob = await (await fetch(signaturePreview)).blob();
      const formData = new FormData();
      formData.append(
        "signature",
        signatureBlob,
        `team-${selectedTeam.teamNumber}.png`,
      );

      const uploadResponse = await fetch(
        createApiUrl("/api/uploads/signature"),
        {
          method: "POST",
          body: formData,
        },
      );
      const uploadPayload = await uploadResponse.json();

      if (!uploadResponse.ok) {
        throw new Error(uploadPayload.error || "Failed to upload signature.");
      }

      const patchResponse = await fetch(
        createApiUrl(`/api/teams/${selectedTeam.id}`),
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            wristbandsActual: Number(wristbandsActualInput),
            parkingPass: parkingPassInput,
            pickupNotes: pickupNotes.trim(),
            pickupName: trimmedPickupName,
            pickupPhoneNumber: parsedPickupPhone.number,
            signatureImagePath: uploadPayload.path,
            checkedIn: true,
          }),
        },
      );
      const patchPayload = await patchResponse.json();

      if (!patchResponse.ok) {
        throw new Error(patchPayload.error || "Failed to confirm pickup.");
      }

      const updatedTeam = normalizeTeam(patchPayload);
      setTeams((currentTeams) =>
        currentTeams.map((team) =>
          team.id === updatedTeam.id ? updatedTeam : team,
        ),
      );
      signaturePadRef.current?.clear();
      setPickupSummary({
        wristbandsActual: Number(wristbandsActualInput),
        parkingPass: parkingPassInput,
      });
      setPickupResult("success");
      setCheckInStep("result");
    } catch (error) {
      setPickupResult("error");
      setPickupResultMessage(
        error.message || "Something went wrong while recording this pickup.",
      );
      setCheckInStep("result");
    } finally {
      setIsSavingTeam(false);
    }
  }

  if (isLoadingEvents) {
    return (
      <main className="min-h-screen bg-slate-100 px-4 py-6 text-slate-900 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-4xl rounded-[28px] border border-slate-200 bg-white p-8 shadow-[0_24px_80px_rgba(15,23,42,0.08)]">
          <p className="text-sm font-semibold text-slate-600">
            Loading events...
          </p>
        </div>
      </main>
    );
  }

  if (!selectedEvent && !selectedCombinedDashboard) {
    return (
      <>
        <main className="min-h-screen bg-slate-100 px-4 py-6 text-slate-900 sm:px-6 lg:px-8">
          <div className="mx-auto flex max-w-5xl flex-col gap-5">
            {eventsError ? (
              <section className="rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm font-semibold text-red-700">
                {eventsError}
              </section>
            ) : null}

            <section className="grid gap-5 rounded-[28px] border border-slate-200 bg-white p-6 shadow-[0_24px_80px_rgba(15,23,42,0.08)] lg:grid-cols-[1.1fr_0.9fr]">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">
                  Event Check-In
                </p>
                <h1 className="mt-3 text-4xl font-black tracking-tight text-slate-950 sm:text-5xl">
                  Choose an imported event or add a new event code
                </h1>
                <p className="mt-4 max-w-2xl text-base leading-7 text-slate-600">
                  Import a RobotEvents event by code through the backend, then
                  open that event’s dashboard to run check-in just for that event.
                </p>
              </div>

              <form
                className="rounded-[24px] border border-slate-200 bg-slate-50 p-5"
                onSubmit={handleImportEvent}
              >
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">
                  Import Event
                </p>
                <label className="mt-4 grid gap-2">
                  <span className="text-sm font-semibold text-slate-700">
                    Event code
                  </span>
                  <input
                    type="text"
                    value={eventCodeInput}
                    onChange={(event) =>
                      setEventCodeInput(event.target.value.toUpperCase())
                    }
                    className="h-12 rounded-2xl border border-slate-300 bg-white px-4 text-base font-semibold text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                    placeholder="RE-V5RC-26-4025"
                  />
                </label>
                <p
                  className={`mt-3 min-h-5 text-sm font-semibold ${
                    eventImportError ? "text-red-600" : "text-slate-500"
                  }`}
                >
                  {eventImportError ||
                    "Imports event info and all registered teams."}
                </p>
                <button
                  type="submit"
                  className="mt-4 rounded-full bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                  disabled={isImportingEvent}
                >
                  {isImportingEvent ? "Importing..." : "Import Event"}
                </button>
                <button
                  type="button"
                  className="mt-4 ml-3 rounded-full border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-slate-100"
                  onClick={openCombinedDashboardModal}
                >
                  Create Combined Dashboard
                </button>
              </form>
            </section>

            <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-[0_24px_80px_rgba(15,23,42,0.08)]">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">
                    Combined Dashboards
                  </p>
                  <h2 className="mt-2 text-2xl font-black tracking-tight text-slate-950">
                    Open a saved combined dashboard
                  </h2>
                </div>
                <span className="rounded-full bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700">
                  {combinedDashboards.length} saved
                </span>
              </div>

              {combinedDashboards.length === 0 ? (
                <div className="mt-5 rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-5 py-10 text-center text-sm font-medium text-slate-500">
                  No combined dashboards saved yet.
                </div>
              ) : (
                <div className="mt-5 grid gap-3">
                  {combinedDashboards.map((dashboard) => {
                    const dashboardEvents = dashboard.eventIds
                      .map((eventId) => events.find((event) => event.id === eventId))
                      .filter(Boolean);

                    return (
                    <button
                      key={dashboard.id}
                      type="button"
                      className="rounded-[24px] border border-slate-200 bg-slate-50 px-5 py-4 text-left transition hover:border-slate-300 hover:bg-slate-100"
                      onClick={() => navigate(`/combined/${dashboard.id}`)}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0 flex-1">
                            <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">
                              Combined
                            </p>
                            <h3 className="mt-2 truncate text-lg font-black text-slate-950">
                              {dashboard.name}
                            </h3>
                            <p className="mt-2 truncate text-sm font-medium text-slate-600">
                              {dashboardEvents.map((event) => event.eventCode).join(" • ")}
                            </p>
                          </div>
                          <div className="shrink-0 text-right text-sm text-slate-600">
                            <p className="font-semibold text-slate-800">
                              {dashboard.eventIds.length} events
                            </p>
                            <button
                              type="button"
                              className="mt-3 rounded-full border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-bold text-red-700 transition hover:border-red-300 hover:bg-red-100"
                              onClick={(event) =>
                                handleRemoveCombinedDashboard(event, dashboard.id)
                              }
                            >
                              Remove
                            </button>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </section>

            <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-[0_24px_80px_rgba(15,23,42,0.08)]">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">
                    Imported Events
                  </p>
                  <h2 className="mt-2 text-2xl font-black tracking-tight text-slate-950">
                    Open an event dashboard
                  </h2>
                </div>
                <span className="rounded-full bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700">
                  {events.length} imported
                </span>
              </div>

              {events.length === 0 ? (
                <div className="mt-5 rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-5 py-10 text-center text-sm font-medium text-slate-500">
                  No events imported yet.
                </div>
              ) : (
                <div className="mt-5 grid gap-3">
                  {events.map((event) => (
                    <button
                      key={event.id}
                      type="button"
                      className="rounded-[24px] border border-slate-200 bg-slate-50 px-5 py-4 text-left transition hover:border-slate-300 hover:bg-slate-100"
                      onClick={() => navigate(`/events/${event.id}`)}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">
                              {event.eventCode}
                            </p>
                          </div>
                          <h3 className="mt-2 truncate text-lg font-black text-slate-950">
                            {event.name}
                          </h3>
                          <p className="mt-2 truncate text-sm font-medium text-slate-600">
                            {[
                              event.locationCity,
                              event.locationRegion,
                              event.locationCountry,
                            ]
                              .filter(Boolean)
                              .join(", ")}
                          </p>
                        </div>
                        <div className="shrink-0 text-right text-sm text-slate-600">
                          <p className="font-semibold text-slate-800">
                            {formatEventDateRange(event.startAt, event.endAt)}
                          </p>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </section>
          </div>
        </main>
        {combinedDashboardModal}
      </>
    );
  }

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-6 text-slate-900 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-5">
        {isCombinedView && combinedTeamsError ? (
          <section className="rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm font-semibold text-red-700">
            {combinedTeamsError}
          </section>
        ) : null}
        {!isCombinedView && teamsError ? (
          <section className="rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm font-semibold text-red-700">
            {teamsError}
          </section>
        ) : null}

        <section className="grid gap-5 rounded-[28px] border border-slate-200 bg-white p-6 shadow-[0_24px_80px_rgba(15,23,42,0.08)] lg:grid-cols-[1.5fr_1fr]">
          <div className="flex flex-col justify-between gap-6">
            <div>
              <div className="mb-4 flex items-center gap-3">
                <img
                  src="/recf_logo.png"
                  alt="Dashboard logo"
                  className="h-14 w-auto object-contain sm:h-16"
                />
                {!isCombinedView ? (
                  <button
                    type="button"
                    className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-slate-50"
                    onClick={openCombinedDashboardModal}
                  >
                    Combined
                  </button>
                ) : null}
              </div>
              <h1 className="text-4xl font-black tracking-tight text-slate-950 sm:text-5xl">
                {isCombinedView
                  ? "Combined team check-in dashboard"
                  : "Team check-in dashboard"}
              </h1>
              <div className="mt-4 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-base font-semibold text-slate-700">
                    {isCombinedView
                      ? selectedCombinedDashboard.name
                      : selectedEvent.name}
                  </p>
                </div>
                {isCombinedView ? (
                  <>
                    <div className="space-y-1">
                      {combinedEventEntries.map((event) => (
                        <div
                          key={event.id}
                          className="grid grid-cols-[max-content_max-content_1fr] items-baseline gap-2 text-sm text-slate-500"
                          title={`${event.eventCode} - ${event.name}`}
                        >
                          <span className="font-mono">{event.eventCode}</span>
                          <span>-</span>
                          <span className="truncate">{event.name}</span>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <>
                    <p className="text-sm font-semibold text-slate-600">
                      {selectedEvent.eventCode}
                    </p>
                    <p className="text-sm text-slate-500">
                      {[
                        selectedEvent.locationVenue,
                        selectedEvent.locationCity,
                        selectedEvent.locationRegion,
                      ]
                        .filter(Boolean)
                        .join(" • ")}
                    </p>
                    <p className="text-sm text-slate-500">
                      {formatEventDateRange(
                        selectedEvent.startAt,
                        selectedEvent.endAt,
                      )}
                    </p>
                  </>
                )}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              {isCombinedView
                ? combinedMetricCards.map((card) => (
                    <CombinedMetricCard
                      key={card.title}
                      {...card}
                      activeTooltipKey={activeCombinedTooltipKey}
                      onToggleTooltip={handleToggleCombinedTooltip}
                    />
                  ))
                : (
                  <>
                    <article className="rounded-2xl bg-slate-950 px-5 py-4 text-white">
                      <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">
                        Total Teams
                      </p>
                      <strong className="mt-3 block text-3xl font-black">
                        {totalTeams}
                      </strong>
                    </article>
                    <article className="rounded-2xl bg-slate-800 px-5 py-4 text-white">
                      <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">
                        Pre-Checked
                      </p>
                      <strong className="mt-3 block text-3xl font-black">
                        {preCheckedCount}
                      </strong>
                    </article>
                    <article className="rounded-2xl bg-slate-700 px-5 py-4 text-white">
                      <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-300">
                        Fully Checked
                      </p>
                      <strong className="mt-3 block text-3xl font-black">
                        {fullyCheckedCount}
                      </strong>
                    </article>
                  </>
                )}
            </div>

            <div className="flex">
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  className="rounded-full border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-slate-50"
                  onClick={() => navigate("/")}
                >
                  {isCombinedView ? "Back To Dashboards" : "Change Event"}
                </button>
              </div>
            </div>
          </div>

          <div className="rounded-[24px] border border-slate-200 bg-slate-50 p-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-slate-600">
                  Status distribution
                </p>
                <p className="text-sm text-slate-500">
                  Fully checked, pre-checked only, and still pending
                </p>
              </div>
            </div>

            <div className="mt-5 flex flex-col items-center gap-5 sm:flex-row sm:items-center">
              <div className="group relative h-48 w-48 rounded-full" style={pieStyle}>
                <div className="absolute inset-[22%] flex items-center justify-center rounded-full bg-white">
                  <div className="text-center">
                    <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">
                      Teams
                    </p>
                    <p className="mt-2 text-3xl font-black text-slate-950">
                      {totalTeams}
                    </p>
                  </div>
                </div>
                {isCombinedView ? (
                  <BreakdownTooltip
                    items={combinedBreakdowns.map((item) => ({
                      key: `pie-${item.eventId}`,
                      label: item.eventCode,
                      value: `${item.fullyChecked}/${item.preCheckedOnly}/${item.notPreChecked}`,
                    }))}
                  />
                ) : null}
              </div>

              <div className="grid flex-1 gap-3 text-sm">
                {isCombinedView ? (
                  <>
                    <CombinedLegendRow
                      color={combinedStatusPalettes.checkedIn[1]}
                      label="Fully checked in"
                      value={fullyCheckedCount}
                      tooltipItems={combinedBreakdowns.map((item) => ({
                        key: `legend-full-${item.eventId}`,
                        label: item.eventCode,
                        value: item.fullyChecked,
                      }))}
                    />
                    <CombinedLegendRow
                      color={combinedStatusPalettes.preCheckedOnly[1]}
                      label="Pre-checked only"
                      value={preCheckedOnlyCount}
                      tooltipItems={combinedBreakdowns.map((item) => ({
                        key: `legend-pre-${item.eventId}`,
                        label: item.eventCode,
                        value: item.preCheckedOnly,
                      }))}
                    />
                    <CombinedLegendRow
                      color={combinedStatusPalettes.notPreChecked[1]}
                      label="Not pre-checked"
                      value={notPreCheckedCount}
                      tooltipItems={combinedBreakdowns.map((item) => ({
                        key: `legend-pending-${item.eventId}`,
                        label: item.eventCode,
                        value: item.notPreChecked,
                      }))}
                    />
                  </>
                ) : (
                  <>
                    <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3">
                      <div className="flex items-center gap-3">
                        <span className="h-3 w-3 rounded-full bg-slate-950" />
                        <span className="font-semibold text-slate-700">
                          Fully checked in
                        </span>
                      </div>
                      <span className="font-bold text-slate-950">
                        {fullyCheckedCount}
                      </span>
                    </div>
                    <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3">
                      <div className="flex items-center gap-3">
                        <span className="h-3 w-3 rounded-full bg-slate-600" />
                        <span className="font-semibold text-slate-700">
                          Pre-checked only
                        </span>
                      </div>
                      <span className="font-bold text-slate-950">
                        {preCheckedOnlyCount}
                      </span>
                    </div>
                    <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3">
                      <div className="flex items-center gap-3">
                        <span className="h-3 w-3 rounded-full bg-slate-300" />
                        <span className="font-semibold text-slate-700">
                          Not pre-checked
                        </span>
                      </div>
                      <span className="font-bold text-slate-950">
                        {notPreCheckedCount}
                      </span>
                    </div>
                  </>
                )}
              </div>
            </div>

            <div className="mt-4 grid gap-2 rounded-2xl border border-slate-200 bg-white p-3">
              {isCombinedView ? (
                <>
                  <CombinedTotalRow
                    label="Total Estimated Wristbands"
                    value={estimatedWristbandsTotal}
                    tooltipItems={combinedBreakdowns.map((item) => ({
                      key: `est-${item.eventId}`,
                      label: item.eventCode,
                      value: item.estimatedWristbands,
                    }))}
                  />
                  <CombinedTotalRow
                    label="Total Wristbands Distributed"
                    value={actualWristbandsDistributedTotal}
                    tooltipItems={combinedBreakdowns.map((item) => ({
                      key: `act-${item.eventId}`,
                      label: item.eventCode,
                      value: item.actualWristbands,
                    }))}
                  />
                  <CombinedTotalRow
                    label="Total Parking Passes Distributed"
                    value={parkingPassesDistributedTotal}
                    tooltipItems={combinedBreakdowns.map((item) => ({
                      key: `park-${item.eventId}`,
                      label: item.eventCode,
                      value: item.parkingPasses,
                    }))}
                  />
                </>
              ) : (
                <>
                  <div className="flex items-baseline justify-between gap-4 rounded-xl bg-slate-50 px-3 py-2">
                    <p className="text-sm font-semibold text-slate-700">
                      Total Estimated Wristbands
                    </p>
                    <p className="text-xl font-black text-slate-950">
                      {estimatedWristbandsTotal}
                    </p>
                  </div>
                  <div className="flex items-baseline justify-between gap-4 rounded-xl bg-slate-50 px-3 py-2">
                    <p className="text-sm font-semibold text-slate-700">
                      Total Wristbands Distributed
                    </p>
                    <p className="text-xl font-black text-slate-950">
                      {actualWristbandsDistributedTotal}
                    </p>
                  </div>
                  <div className="flex items-baseline justify-between gap-4 rounded-xl bg-slate-50 px-3 py-2">
                    <p className="text-sm font-semibold text-slate-700">
                      Total Parking Passes Distributed
                    </p>
                    <p className="text-xl font-black text-slate-950">
                      {parkingPassesDistributedTotal}
                    </p>
                  </div>
                </>
              )}
            </div>
          </div>
        </section>

        <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-[0_24px_80px_rgba(15,23,42,0.08)]">
          <div className="flex flex-wrap items-end gap-4 border-b border-slate-200 px-6 py-5">
            <div className="grid gap-2">
              <div className="flex flex-wrap gap-4">
                <div className="grid gap-2">
                  <span className="text-sm font-semibold text-slate-700">
                    Pre-Checked In
                  </span>
                  <div className="flex flex-wrap gap-2">
                    {triStateOptions.map((option) => (
                      <button
                        key={`preChecked-${option.value}`}
                        type="button"
                        className={`rounded-2xl border px-4 py-2.5 text-sm font-semibold transition ${
                          statusFilters.preChecked === option.value
                            ? "border-slate-900 bg-slate-900 text-white shadow-sm"
                            : "border-slate-300 bg-white text-slate-600 hover:border-slate-400 hover:text-slate-900"
                        }`}
                        onClick={() =>
                          handleStatusFilterChange("preChecked", option.value)
                        }
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid gap-2">
                  <span className="text-sm font-semibold text-slate-700">
                    Fully Checked In
                  </span>
                  <div className="flex flex-wrap gap-2">
                    {triStateOptions.map((option) => (
                      <button
                        key={`checkedIn-${option.value}`}
                        type="button"
                        className={`rounded-2xl border px-4 py-2.5 text-sm font-semibold transition ${
                          statusFilters.checkedIn === option.value
                            ? "border-slate-900 bg-slate-900 text-white shadow-sm"
                            : "border-slate-300 bg-white text-slate-600 hover:border-slate-400 hover:text-slate-900"
                        }`}
                        onClick={() =>
                          handleStatusFilterChange("checkedIn", option.value)
                        }
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <label className="grid min-w-[260px] flex-1 gap-2">
              <span className="text-sm font-semibold text-slate-700">
                Search Teams
              </span>
              <input
                type="search"
                value={searchTerm}
                onChange={handleSearchTermChange}
                className="h-11 rounded-2xl border border-slate-300 bg-white px-4 text-sm font-medium text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                placeholder={
                  isCombinedView
                    ? "Search by team number"
                    : "Team #, name, organization, contact, or phone"
                }
              />
            </label>
          </div>

          <div className="flex flex-col gap-2 border-b border-slate-200 px-6 py-4 text-sm text-slate-600 sm:flex-row sm:items-center sm:justify-between">
            <p>
              Showing{" "}
              <strong className="text-slate-950">
                {paginatedTeams.length}
              </strong>{" "}
              of{" "}
              <strong className="text-slate-950">{sortedTeams.length}</strong>{" "}
              matching teams
            </p>
            <p>
              Sorted by{" "}
              <strong className="text-slate-950">
                {currentColumns.find((column) => column.key === sortConfig.key)?.label}
              </strong>{" "}
              ({sortConfig.direction})
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full border-separate border-spacing-0">
              <thead>
                <tr className="bg-slate-50">
                  {currentColumns.map((column) => {
                    const isActive = sortConfig.key === column.key;
                    const arrow = isActive
                      ? sortConfig.direction === "asc"
                        ? "↑"
                        : "↓"
                      : "↕";

                    return (
                      <th
                        key={column.key}
                        className="border-b border-slate-200 px-6 py-4 text-left"
                      >
                        <button
                          type="button"
                          className={`inline-flex items-center gap-2 text-sm font-bold ${
                            isActive ? "text-slate-950" : "text-slate-600"
                          }`}
                          onClick={() => handleSort(column.key)}
                        >
                          <span>{column.label}</span>
                          <span className="text-xs">{arrow}</span>
                        </button>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {paginatedTeams.length > 0 ? (
                  isCombinedView ? (
                    paginatedTeams.map((team) => (
                      <tr
                        key={team.id}
                        className="h-14 cursor-pointer even:bg-slate-50/70 hover:bg-slate-100"
                        onClick={() => setSelectedTeamId(team.id)}
                      >
                        <td className="border-b border-slate-200 px-6 py-4 text-sm font-semibold text-slate-900">
                          {team.eventCode}
                        </td>
                        <td className="border-b border-slate-200 px-6 py-4 text-sm font-semibold text-slate-900">
                          {team.teamNumber}
                        </td>
                        <td className="border-b border-slate-200 px-6 py-4 text-sm text-slate-700">
                          {team.teamName}
                        </td>
                        <td className="border-b border-slate-200 px-6 py-4">
                          <StatBadge value={team.preCheckedIn} />
                        </td>
                        <td className="border-b border-slate-200 px-6 py-4">
                          <StatBadge value={team.checkedIn} />
                        </td>
                      </tr>
                    ))
                  ) : (
                    paginatedTeams.map((team) => (
                      <tr
                        key={team.id}
                        className="h-14 cursor-pointer even:bg-slate-50/70 hover:bg-slate-100"
                        onClick={() => setSelectedTeamId(team.id)}
                      >
                        <td className="border-b border-slate-200 px-6 py-4 text-sm font-semibold text-slate-900">
                          {team.teamNumber}
                        </td>
                        <td className="border-b border-slate-200 px-6 py-4 text-sm text-slate-700">
                          {team.teamName}
                        </td>
                        <td className="border-b border-slate-200 px-6 py-4">
                          <StatBadge value={team.preCheckedIn} />
                        </td>
                        <td className="border-b border-slate-200 px-6 py-4">
                          <StatBadge value={team.checkedIn} />
                        </td>
                      </tr>
                    ))
                  )
                ) : (
                  <tr>
                    <td
                      className="px-6 py-14 text-center text-sm text-slate-500"
                      colSpan={currentColumns.length}
                    >
                      {isCombinedView
                        ? isLoadingCombinedTeams
                          ? "Loading teams..."
                          : "No teams match the selected filters."
                        : isLoadingTeams
                        ? "Loading teams..."
                        : "No teams match the selected filters."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="flex flex-col gap-4 border-t border-slate-200 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-5">
              <div className="text-sm text-slate-600">
                Page{" "}
                <strong className="text-slate-950">{safeCurrentPage}</strong> of{" "}
                <strong className="text-slate-950">{totalPages}</strong>
              </div>
              {sortedTeams.length >= 10 ? (
                <label className="flex items-center gap-3 text-sm text-slate-600">
                  <span className="font-semibold text-slate-700">
                    Page size
                  </span>
                  <StyledSelect
                    value={String(pageSize)}
                    onChange={handlePageSizeChange}
                  >
                    {pageSizeOptions.map((option) => (
                      <option key={String(option)} value={String(option)}>
                        {option === "all" ? "All" : option}
                      </option>
                    ))}
                  </StyledSelect>
                </label>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                onClick={() => setCurrentPage(1)}
                disabled={safeCurrentPage === 1 || pageSize === "all"}
              >
                First
              </button>
              <button
                type="button"
                className="rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                disabled={safeCurrentPage === 1 || pageSize === "all"}
              >
                Previous
              </button>

              {visiblePageNumbers[0] > 1 ? (
                <>
                  <button
                    type="button"
                    className={`rounded-full px-3 py-2 text-sm font-semibold transition ${
                      safeCurrentPage === 1
                        ? "bg-slate-900 text-white"
                        : "bg-slate-200 text-slate-700 hover:bg-slate-300"
                    }`}
                    onClick={() => setCurrentPage(1)}
                    disabled={pageSize === "all"}
                  >
                    1
                  </button>
                  {visiblePageNumbers[0] > 2 ? (
                    <span className="px-1 text-sm font-semibold text-slate-500">
                      ...
                    </span>
                  ) : null}
                </>
              ) : null}

              {visiblePageNumbers.map((pageNumber) => (
                <button
                  key={pageNumber}
                  type="button"
                  className={`rounded-full px-3 py-2 text-sm font-semibold transition ${
                    safeCurrentPage === pageNumber
                      ? "bg-slate-900 text-white"
                      : "bg-slate-200 text-slate-700 hover:bg-slate-300"
                  }`}
                  onClick={() => setCurrentPage(pageNumber)}
                  disabled={pageSize === "all"}
                >
                  {pageNumber}
                </button>
              ))}

              {visiblePageNumbers[visiblePageNumbers.length - 1] <
              totalPages ? (
                <>
                  {visiblePageNumbers[visiblePageNumbers.length - 1] <
                  totalPages - 1 ? (
                    <span className="px-1 text-sm font-semibold text-slate-500">
                      ...
                    </span>
                  ) : null}
                  <button
                    type="button"
                    className={`rounded-full px-3 py-2 text-sm font-semibold transition ${
                      safeCurrentPage === totalPages
                        ? "bg-slate-900 text-white"
                        : "bg-slate-200 text-slate-700 hover:bg-slate-300"
                    }`}
                    onClick={() => setCurrentPage(totalPages)}
                    disabled={pageSize === "all"}
                  >
                    {totalPages}
                  </button>
                </>
              ) : null}

              <button
                type="button"
                className="rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                onClick={() =>
                  setCurrentPage((page) => Math.min(totalPages, page + 1))
                }
                disabled={safeCurrentPage === totalPages || pageSize === "all"}
              >
                Next
              </button>
              <button
                type="button"
                className="rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                onClick={() => setCurrentPage(totalPages)}
                disabled={safeCurrentPage === totalPages || pageSize === "all"}
              >
                Last
              </button>
            </div>
          </div>

          <div className="border-t border-slate-200 px-6 py-4">
            <div className="flex justify-end">
              <button
                type="button"
                className="rounded-full bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800"
                onClick={handleExportCsv}
              >
                Export All Data CSV
              </button>
            </div>
          </div>
        </section>
      </div>

      {selectedTeam ? (
        <div
          className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-slate-950/40 py-4 sm:py-6 px-2 sm:px-4 backdrop-blur-sm"
          onClick={closeTeamModal}
        >
          <section
            className="my-auto flex max-h-[calc(100dvh-2rem)] w-full max-w-5xl flex-col overflow-hidden rounded-[24px] bg-white shadow-[0_30px_120px_rgba(15,23,42,0.25)] sm:max-h-[calc(100dvh-3rem)] sm:rounded-[28px]"
            onClick={(event) => event.stopPropagation()}
            aria-modal="true"
            role="dialog"
          >
            <div className="flex shrink-0 flex-col gap-2 border-b border-slate-200 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-2xl font-black tracking-tight text-slate-950 sm:text-3xl">
                  Team {selectedTeam.teamNumber}: {selectedTeam.teamName}
                </h2>
              </div>
              {!(checkInStep === "result" && pickupResult === "success") ? (
                <button
                  type="button"
                  className="rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
                  onClick={closeTeamModal}
                  aria-label="Close team details"
                >
                  Close
                </button>
              ) : null}
            </div>

            <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 py-3">
              <div className="grid shrink-0 gap-3 lg:grid-cols-3">
                <DetailCard
                  label="Organization"
                  value={selectedTeam.organization}
                  copyKey="organization"
                  copiedField={copiedField}
                  onCopy={handleCopy}
                  compact
                />
                <DetailCard
                  label="Contact Name"
                  value={selectedTeam.contactName}
                  copyKey="contactName"
                  copiedField={copiedField}
                  onCopy={handleCopy}
                  compact
                />
                <DetailCard
                  label="Contact Number"
                  value={formatPhoneDisplay(selectedTeam.contactNumber)}
                  copyKey="contactNumber"
                  copiedField={copiedField}
                  onCopy={handleCopy}
                  compact
                />
              </div>

              <div className="mt-3 grid shrink-0 gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-3 sm:grid-cols-2 lg:grid-cols-4">
                <TeamProgressField
                  preCheckedIn={
                    checkInStep === "result" && pickupResult === "success"
                      ? true
                      : selectedTeam.preCheckedIn
                  }
                  checkedIn={
                    checkInStep === "result" && pickupResult === "success"
                      ? true
                      : selectedTeam.checkedIn
                  }
                  className={
                    checkInStep === "result" && pickupResult === "success"
                      ? "lg:col-span-4"
                      : ""
                  }
                />
                {!(checkInStep === "result" && pickupResult === "success") ? (
                  <>
                    <SimpleField
                      label="Wristbands"
                      value={selectedTeamWristbandsSummary}
                    />
                    <SimpleField
                      label="Parking Pass"
                      value={selectedTeamParkingSummary}
                    />
                  </>
                ) : null}
              </div>

              <div className="mt-3 flex min-h-0 flex-1 flex-col overflow-hidden">
                {checkInStep === "result" ? (
                  <div className="flex min-h-0 flex-1 flex-col justify-center rounded-[24px] border border-slate-200 bg-slate-50 p-4 sm:p-6">
                    {pickupResult === "success" ? (
                      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center text-center">
                        <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">
                          Pickup Recorded
                        </p>
                        <h3 className="mt-3 text-3xl font-black tracking-tight text-slate-950">
                          Give this team:
                        </h3>
                        <div
                          className={`mt-5 grid gap-3 ${
                            pickupSummary.parkingPass
                              ? "sm:grid-cols-3"
                              : "mx-auto w-full max-w-lg sm:grid-cols-2"
                          }`}
                        >
                          <div className="rounded-3xl border border-slate-200 bg-white px-4 py-5">
                            <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">
                              Bag
                            </p>
                            <p className="mt-2 text-3xl font-black text-slate-950">
                              1
                            </p>
                          </div>
                          <div className="rounded-3xl border border-slate-200 bg-white px-4 py-5">
                            <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">
                              Wristbands
                            </p>
                            <p className="mt-2 text-3xl font-black text-slate-950">
                              {pickupSummary.wristbandsActual}
                            </p>
                          </div>
                          {pickupSummary.parkingPass ? (
                            <div className="rounded-3xl border border-slate-200 bg-white px-4 py-5">
                              <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">
                                Parking Pass
                              </p>
                              <p className="mt-2 text-3xl font-black text-slate-950">
                                1
                              </p>
                            </div>
                          ) : null}
                        </div>
                        <div className="mt-6 flex justify-center">
                          <button
                            type="button"
                            className="rounded-full bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800"
                            onClick={closeTeamModal}
                          >
                            OK
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center text-center">
                        <p className="text-xs font-bold uppercase tracking-[0.18em] text-red-500">
                          Something Went Wrong
                        </p>
                        <h3 className="mt-3 text-3xl font-black tracking-tight text-slate-950">
                          Pickup was not recorded.
                        </h3>
                        <p className="mt-4 text-base font-medium leading-7 text-slate-600">
                          {pickupResultMessage ||
                            "We could not confirm this pickup with the backend."}
                        </p>
                        <div className="mt-6 flex justify-center">
                          <button
                            type="button"
                            className="rounded-full bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800"
                            onClick={() => {
                              setPickupResult(null);
                              setPickupResultMessage("");
                              setCheckInStep("wristbands");
                            }}
                          >
                            Retry
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ) : selectedTeam.signaturePreview ? (
                  <div className="flex min-h-0 flex-1 flex-col rounded-[24px] border border-slate-200 bg-slate-50 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">
                        Checked-In Details
                      </p>
                      <div className="relative inline-grid grid-cols-2 rounded-full bg-white p-1 shadow-sm">
                        <div
                          className={`absolute inset-y-1 w-[calc(50%-0.25rem)] rounded-full bg-slate-900 transition-transform duration-300 ease-out ${
                            checkedInPanel === "signature"
                              ? "translate-x-0"
                              : "translate-x-full"
                          }`}
                        />
                        <button
                          type="button"
                          className={`relative z-10 rounded-full px-4 py-2 text-sm font-semibold transition ${
                            checkedInPanel === "signature"
                              ? "text-white"
                              : "text-slate-600"
                          }`}
                          onClick={() => setCheckedInPanel("signature")}
                        >
                          Signature
                        </button>
                        <button
                          type="button"
                          className={`relative z-10 rounded-full px-4 py-2 text-sm font-semibold transition ${
                            checkedInPanel === "notes"
                              ? "text-white"
                              : "text-slate-600"
                          }`}
                          onClick={() => setCheckedInPanel("notes")}
                        >
                          Notes
                        </button>
                      </div>
                    </div>

                    <div
                      className="mt-4 flex min-h-0 flex-1 overflow-hidden"
                      onTouchStart={handleCheckedInPanelTouchStart}
                      onTouchEnd={handleCheckedInPanelTouchEnd}
                    >
                      <div
                        className={`flex min-h-0 w-full flex-1 transition-transform duration-300 ease-out ${
                          checkedInPanel === "signature"
                            ? "translate-x-0"
                            : "-translate-x-full"
                        }`}
                      >
                        <div className="flex min-h-0 w-full shrink-0 flex-col gap-4 overflow-y-auto pr-1">
                          <div className="grid gap-2 sm:grid-cols-2">
                            <CopyableSimpleField
                              label="Pick Up Full Name"
                              value={selectedTeam.pickupName || "Not recorded"}
                              copyKey="pickupName"
                              copiedField={copiedField}
                              onCopy={handleCopy}
                            />
                            <CopyableSimpleField
                              label="Pick Up Phone Number"
                              value={formatPhoneDisplay(
                                selectedTeam.pickupPhoneNumber,
                              )}
                              copyKey="pickupPhoneNumber"
                              copiedField={copiedField}
                              onCopy={handleCopy}
                            />
                          </div>
                          <div className="flex min-h-0 flex-1">
                            <div className="flex min-h-0 w-full items-center justify-center rounded-2xl bg-white p-4">
                              <img
                                src={selectedTeam.signaturePreview}
                                alt={`Saved signature for ${selectedTeam.teamName}`}
                                className="max-h-full w-full rounded-xl bg-white object-contain"
                              />
                            </div>
                          </div>
                        </div>

                        <div className="flex min-h-0 w-full shrink-0 flex-col gap-4 overflow-y-auto pl-4 pr-1">
                          <div className="grid gap-2 sm:grid-cols-2">
                            <CopyableSimpleField
                              label="Pick Up Full Name"
                              value={selectedTeam.pickupName || "Not recorded"}
                              copyKey="pickupName"
                              copiedField={copiedField}
                              onCopy={handleCopy}
                            />
                            <CopyableSimpleField
                              label="Pick Up Phone Number"
                              value={formatPhoneDisplay(
                                selectedTeam.pickupPhoneNumber,
                              )}
                              copyKey="pickupPhoneNumber"
                              copiedField={copiedField}
                              onCopy={handleCopy}
                            />
                          </div>
                          <div className="flex min-h-0 flex-1">
                            <div className="flex min-h-0 w-full flex-col rounded-2xl bg-white p-5">
                              <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">
                                Pickup Notes
                              </p>
                              <div className="mt-4 min-h-0 flex-1 overflow-y-auto rounded-xl bg-slate-50 px-5 py-4 text-left text-sm font-medium leading-7 text-slate-700">
                                {selectedTeam.pickupNotes?.trim() ||
                                  "No notes recorded."}
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : !selectedTeam.checkedIn && checkInStep === "wristbands" ? (
                  <div className="relative flex min-h-0 flex-1 flex-col overflow-y-auto rounded-[24px] border border-slate-200 bg-slate-50 p-3.5">
                    <div
                      className={`transition ${
                        selectedTeam.preCheckedIn
                          ? ""
                          : "pointer-events-none select-none blur-[2px] opacity-45"
                      }`}
                      aria-hidden={!selectedTeam.preCheckedIn}
                    >
                      <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">
                        Wristbands and Parking
                      </p>
                      <p className="mt-1.5 text-sm font-semibold text-slate-700">
                        Estimated Wristbands are{" "}
                        {selectedTeam.wristbandsEstimated}
                      </p>

                      <div className="mt-2.5 space-y-2.5">
                        <div className="grid gap-2.5 lg:grid-cols-[1fr_auto] lg:items-start">
                          <label className="grid gap-1.5">
                            <span className="text-sm font-semibold text-slate-700">
                              Enter the actual number of wristbands
                            </span>
                            <input
                              type="text"
                              inputMode="numeric"
                              pattern="[0-9]*"
                              value={wristbandsActualInput}
                              onBeforeInput={(event) => {
                                if (event.data && /\D/.test(event.data)) {
                                  event.preventDefault();
                                }
                              }}
                              onPaste={(event) => {
                                const pastedText =
                                  event.clipboardData.getData("text");

                                if (/\D/.test(pastedText)) {
                                  event.preventDefault();
                                  const digitsOnly = pastedText.replace(
                                    /\D/g,
                                    "",
                                  );
                                  const numericValue = Number(digitsOnly);

                                  setWristbandsActualInput(digitsOnly);
                                  setWristbandsError(
                                    digitsOnly !== "" && numericValue > 13
                                      ? "If more than 13 wristbands are needed, pick up extras at spectator check-in."
                                      : "",
                                  );
                                }
                              }}
                              onChange={(event) => {
                                const value = event.target.value.replace(
                                  /\D/g,
                                  "",
                                );
                                const numericValue = Number(value);

                                setWristbandsActualInput(value);
                                setWristbandsError(
                                  value !== "" && numericValue > 13
                                    ? "If more than 13 wristbands are needed, pick up extras at spectator check-in."
                                    : "",
                                );
                              }}
                              className="h-10 rounded-2xl border border-slate-300 bg-white px-4 text-base font-semibold text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                              placeholder="0-13"
                            />
                            <span
                              className={`min-h-5 text-sm font-semibold ${
                                wristbandsError
                                  ? "text-red-600"
                                  : "text-transparent"
                              }`}
                            >
                              {wristbandsError || "No wristband error"}
                            </span>
                          </label>

                          <div className="grid gap-1.5">
                            <span className="text-sm font-semibold text-slate-700">
                              Parking Pass
                            </span>
                            <button
                              type="button"
                              className={`min-w-28 rounded-2xl border px-4 py-2 text-center text-sm font-semibold transition ${
                                parkingPassInput
                                  ? "border-slate-900 bg-slate-900 text-white shadow-sm"
                                  : "border-slate-300 bg-white text-slate-700 hover:border-slate-400"
                              }`}
                              onClick={() =>
                                setParkingPassInput((current) => !current)
                              }
                            >
                              {parkingPassInput ? "Yes" : "No"}
                            </button>
                          </div>
                        </div>

                        <label className="mt-2.5 grid gap-1.5">
                          <span className="text-sm font-semibold text-slate-700">
                            Optional notes
                          </span>
                          <textarea
                            value={pickupNotes}
                            maxLength={1000}
                            onChange={(event) =>
                              setPickupNotes(event.target.value)
                            }
                            className="h-14 resize-none rounded-2xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                            placeholder="Add any optional notes for this pickup..."
                          />
                          <span className="text-right text-xs font-semibold text-slate-500">
                            {pickupNotes.length}/1000
                          </span>
                        </label>

                        <div className="mt-2.5 flex justify-end">
                          <button
                            type="button"
                            className="rounded-full bg-slate-900 px-5 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
                            onClick={handleNextToAcknowledgement}
                          >
                            Next
                          </button>
                        </div>
                      </div>
                    </div>

                    {!selectedTeam.preCheckedIn ? (
                      <div className="absolute inset-0 flex items-center justify-center rounded-[24px] bg-white/30 px-6 text-center">
                        <div className="max-w-xl rounded-3xl border border-amber-200 bg-amber-50/95 px-5 py-4 shadow-sm backdrop-blur-sm">
                          <p className="text-sm font-semibold leading-6 text-amber-950 sm:text-base">
                            Team check-in unlocks after the Online Check-In Form
                            is submitted. Changes can take up to 1 minute to
                            appear.
                          </p>
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : !selectedTeam.checkedIn &&
                  checkInStep === "acknowledgement" ? (
                  <div className="flex min-h-0 flex-1 flex-col overflow-y-auto rounded-[24px] border border-slate-200 bg-slate-50 p-4">
                    <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">
                      Acknowledgement
                    </p>
                    <div className="grid flex-1 place-items-center py-4">
                      <p className="max-w-3xl text-center text-base font-medium leading-7 text-slate-700">
                        I acknowledge that I am authorized to pick up my team's
                        VEX Robotics World Championship swag bag on behalf of
                        the team. By signing below, I confirm that I have
                        received the team swag bag and verified that the
                        quantity of medals, pins, and other items is correct. I
                        understand that my signature confirms this pickup is
                        final, and no changes, additions, or claims for missing
                        items may be made afterward.
                      </p>
                    </div>
                    <div className="flex justify-end">
                      <button
                        type="button"
                        className="rounded-full bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800"
                        onClick={() => setCheckInStep("signature")}
                      >
                        Acknowledge
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex min-h-0 flex-1 flex-col overflow-y-auto rounded-3xl border border-slate-200 bg-slate-50 p-3">
                    <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">
                      Confirm pickup
                    </p>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      <label className="grid gap-1.5">
                        <span className="text-sm font-semibold text-slate-700">
                          Pick Up Full Name
                        </span>
                        <input
                          type="text"
                          value={pickupName}
                          onChange={handlePickupNameChange}
                          className="h-10 rounded-2xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                          placeholder="Jane Doe"
                        />
                        <span
                          className={`min-h-5 text-xs font-semibold ${
                            pickupNameError
                              ? "text-red-600"
                              : "text-transparent"
                          }`}
                        >
                          {pickupNameError || "No pickup name error"}
                        </span>
                      </label>

                      <label className="grid gap-1.5">
                        <span className="text-sm font-semibold text-slate-700">
                          Pick Up Phone Number
                        </span>
                        <input
                          type="tel"
                          inputMode="tel"
                          value={pickupPhone}
                          onChange={handlePickupPhoneChange}
                          className="h-10 rounded-2xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                          placeholder="(555) 123-4567 or +44 20 7183 8750"
                        />
                        <span
                          className={`min-h-5 text-xs font-semibold ${
                            pickupPhoneError
                              ? "text-red-600"
                              : "text-transparent"
                          }`}
                        >
                          {pickupPhoneError || "No pickup phone error"}
                        </span>
                      </label>
                    </div>
                    <div className="mt-0.5 flex min-h-0 flex-1 flex-col rounded-3xl border border-slate-200 bg-white p-3">
                      <SignaturePadCanvas
                        ref={signaturePadRef}
                        penColor="#132231"
                        className="min-h-36 flex-1 w-full rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50"
                      />
                      <div className="mt-3 flex flex-wrap items-center justify-end gap-3">
                        <p
                          className={`mr-auto text-sm font-semibold ${
                            signatureNoticeTone === "error"
                              ? "text-red-600"
                              : signatureNotice
                                ? "text-sky-700"
                                : "text-transparent"
                          }`}
                        >
                          {signatureNotice || "No signature notice"}
                        </p>
                        <button
                          type="button"
                          className="rounded-full bg-slate-200 px-4 py-2 text-sm font-semibold text-slate-800 transition hover:bg-slate-300"
                          onClick={handleClearSignature}
                        >
                          Clear
                        </button>
                        <button
                          type="button"
                          className="rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                          onClick={handleSaveSignature}
                          disabled={isSavingTeam}
                        >
                          {isSavingTeam ? "Saving..." : "Confirm Pickup"}
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </section>
        </div>
      ) : null}

      {combinedDashboardModal}
    </main>
  );
}

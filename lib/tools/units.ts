/**
 * Unit conversion for the `calculate` tool: "5 km to miles", "72 F in C",
 * "(2 + 3) ft to m", "60 mph -> km/h".
 *
 * It lives inside `calculate` rather than being a tool of its own because every
 * tool's schema is sent with every request: a second tool would cost tokens on
 * each turn of every conversation, used or not. (A test holds the calculate
 * tool's schema to no more than it was before conversions existed.)
 *
 * Deliberate gaps, each an error that says so rather than a guess: bare "ton"
 * (US short, UK long or metric?), "calorie" (the physicist's or the dietitian's?),
 * and months (not a fixed length).
 */

export class UnitError extends Error {}

type Dim =
  | "length" | "mass" | "volume" | "time" | "speed" | "area" | "data"
  | "energy" | "power" | "pressure" | "angle" | "temperature";

interface Unit {
  dim: Dim;
  /** What results are shown in. */
  label: string;
  toBase: (v: number) => number;
  fromBase: (v: number) => number;
}

const linear = (dim: Dim, label: string, factor: number): Unit => ({
  dim,
  label,
  toBase: (v) => v * factor,
  fromBase: (v) => v / factor,
});

/** Base units: m, kg, L, s, m/s, m², byte, J, W, Pa, rad, K. */
const UNIT_LIST: [Unit, string[]][] = [
  // --- length ---
  [linear("length", "m", 1), ["m", "meter", "meters", "metre", "metres"]],
  [linear("length", "km", 1000), ["km", "kilometer", "kilometers", "kilometre", "kilometres"]],
  [linear("length", "cm", 0.01), ["cm", "centimeter", "centimeters", "centimetre", "centimetres"]],
  [linear("length", "mm", 0.001), ["mm", "millimeter", "millimeters", "millimetre", "millimetres"]],
  [linear("length", "µm", 1e-6), ["um", "µm", "micrometer", "micrometers", "micrometre", "micrometres", "micron", "microns"]],
  [linear("length", "nm", 1e-9), ["nm", "nanometer", "nanometers", "nanometre", "nanometres"]],
  [linear("length", "mi", 1609.344), ["mi", "mile", "miles"]],
  [linear("length", "yd", 0.9144), ["yd", "yard", "yards"]],
  [linear("length", "ft", 0.3048), ["ft", "foot", "feet"]],
  [linear("length", "in", 0.0254), ["in", "inch", "inches"]],
  [linear("length", "nmi", 1852), ["nmi", "nautical mile", "nautical miles"]],
  // --- mass ---
  [linear("mass", "kg", 1), ["kg", "kilogram", "kilograms", "kilo", "kilos"]],
  [linear("mass", "g", 0.001), ["g", "gram", "grams"]],
  [linear("mass", "mg", 1e-6), ["mg", "milligram", "milligrams"]],
  [linear("mass", "µg", 1e-9), ["ug", "µg", "mcg", "microgram", "micrograms"]],
  [linear("mass", "t", 1000), ["t", "tonne", "tonnes", "metric ton", "metric tons"]],
  [linear("mass", "lb", 0.45359237), ["lb", "lbs", "pound", "pounds"]],
  [linear("mass", "oz", 0.028349523125), ["oz", "ounce", "ounces"]],
  [linear("mass", "st", 6.35029318), ["st", "stone"]],
  [linear("mass", "short ton", 907.18474), ["short ton", "short tons", "us ton", "us tons"]],
  [linear("mass", "long ton", 1016.0469088), ["long ton", "long tons", "uk ton", "uk tons"]],
  // --- volume (US customary unless the name says otherwise) ---
  [linear("volume", "L", 1), ["l", "liter", "liters", "litre", "litres"]],
  [linear("volume", "mL", 0.001), ["ml", "milliliter", "milliliters", "millilitre", "millilitres", "cc", "cm3", "cm^3", "cm³"]],
  [linear("volume", "cL", 0.01), ["cl", "centiliter", "centiliters", "centilitre", "centilitres"]],
  [linear("volume", "dL", 0.1), ["dl", "deciliter", "deciliters", "decilitre", "decilitres"]],
  [linear("volume", "m³", 1000), ["m3", "m^3", "m³", "cubic meter", "cubic meters", "cubic metre", "cubic metres"]],
  [linear("volume", "gal", 3.785411784), ["gal", "gallon", "gallons", "us gal", "us gallon", "us gallons"]],
  [linear("volume", "imp gal", 4.54609), ["imp gal", "imperial gallon", "imperial gallons", "uk gallon", "uk gallons"]],
  [linear("volume", "qt", 0.946352946), ["qt", "quart", "quarts"]],
  [linear("volume", "pt", 0.473176473), ["pt", "pint", "pints"]],
  [linear("volume", "cup", 0.2365882365), ["cup", "cups"]],
  [linear("volume", "fl oz", 0.0295735295625), ["fl oz", "floz", "fluid ounce", "fluid ounces"]],
  [linear("volume", "tbsp", 0.01478676478125), ["tbsp", "tablespoon", "tablespoons"]],
  [linear("volume", "tsp", 0.00492892159375), ["tsp", "teaspoon", "teaspoons"]],
  [linear("volume", "ft³", 28.316846592), ["ft3", "ft^3", "ft³", "cubic foot", "cubic feet"]],
  [linear("volume", "in³", 0.016387064), ["in3", "in^3", "in³", "cubic inch", "cubic inches"]],
  // --- time (a year is the Julian 365.25 days; there are no months) ---
  [linear("time", "s", 1), ["s", "sec", "secs", "second", "seconds"]],
  [linear("time", "ms", 0.001), ["ms", "millisecond", "milliseconds"]],
  [linear("time", "µs", 1e-6), ["us", "µs", "microsecond", "microseconds"]],
  [linear("time", "ns", 1e-9), ["ns", "nanosecond", "nanoseconds"]],
  [linear("time", "min", 60), ["min", "mins", "minute", "minutes"]],
  [linear("time", "h", 3600), ["h", "hr", "hrs", "hour", "hours"]],
  [linear("time", "d", 86400), ["d", "day", "days"]],
  [linear("time", "wk", 604800), ["wk", "wks", "week", "weeks"]],
  [linear("time", "yr", 31557600), ["yr", "yrs", "year", "years"]],
  // --- speed ---
  [linear("speed", "m/s", 1), ["m/s", "mps", "meters per second", "metres per second"]],
  [linear("speed", "km/h", 1000 / 3600), ["km/h", "kmh", "kph", "km/hr", "kilometers per hour", "kilometres per hour"]],
  [linear("speed", "mph", 1609.344 / 3600), ["mph", "mi/h", "mi/hr", "miles per hour"]],
  [linear("speed", "kn", 1852 / 3600), ["kn", "kt", "knot", "knots"]],
  [linear("speed", "ft/s", 0.3048), ["ft/s", "fps", "feet per second"]],
  // --- area ---
  [linear("area", "m²", 1), ["m2", "m^2", "m²", "sqm", "square meter", "square meters", "square metre", "square metres"]],
  [linear("area", "km²", 1e6), ["km2", "km^2", "km²", "square kilometer", "square kilometers", "square kilometre", "square kilometres"]],
  [linear("area", "cm²", 1e-4), ["cm2", "cm^2", "cm²", "square centimeter", "square centimeters"]],
  [linear("area", "ha", 10000), ["ha", "hectare", "hectares"]],
  [linear("area", "acre", 4046.8564224), ["acre", "acres"]],
  [linear("area", "ft²", 0.09290304), ["ft2", "ft^2", "ft²", "sqft", "square foot", "square feet"]],
  [linear("area", "in²", 0.00064516), ["in2", "in^2", "in²", "sqin", "square inch", "square inches"]],
  [linear("area", "yd²", 0.83612736), ["yd2", "yd^2", "yd²", "square yard", "square yards"]],
  [linear("area", "mi²", 2589988.110336), ["mi2", "mi^2", "mi²", "square mile", "square miles"]],
  // --- energy ---
  [linear("energy", "J", 1), ["j", "joule", "joules"]],
  [linear("energy", "kJ", 1000), ["kj", "kilojoule", "kilojoules"]],
  [linear("energy", "cal", 4.184), ["cal", "small calorie", "small calories"]],
  [linear("energy", "kcal", 4184), ["kcal", "kilocalorie", "kilocalories"]],
  [linear("energy", "Wh", 3600), ["wh", "watt hour", "watt hours"]],
  [linear("energy", "kWh", 3.6e6), ["kwh", "kilowatt hour", "kilowatt hours"]],
  [linear("energy", "BTU", 1055.05585262), ["btu", "btus"]],
  // --- power ---
  [linear("power", "W", 1), ["w", "watt", "watts"]],
  [linear("power", "kW", 1000), ["kw", "kilowatt", "kilowatts"]],
  [linear("power", "hp", 745.69987158227), ["hp", "horsepower"]],
  // --- pressure ---
  [linear("pressure", "Pa", 1), ["pa", "pascal", "pascals"]],
  [linear("pressure", "kPa", 1000), ["kpa", "kilopascal", "kilopascals"]],
  [linear("pressure", "bar", 1e5), ["bar", "bars"]],
  [linear("pressure", "mbar", 100), ["mbar", "millibar", "millibars"]],
  [linear("pressure", "atm", 101325), ["atm", "atmosphere", "atmospheres"]],
  [linear("pressure", "psi", 6894.757293168), ["psi"]],
  [linear("pressure", "mmHg", 133.322387415), ["mmhg", "torr"]],
  // --- angle ---
  [linear("angle", "rad", 1), ["rad", "radian", "radians"]],
  [linear("angle", "°", Math.PI / 180), ["deg", "degree", "degrees", "°"]],
  [linear("angle", "turn", 2 * Math.PI), ["turn", "turns", "rev", "revolution", "revolutions"]],
  // --- temperature: not a ratio, so each is a pair of functions through kelvin ---
  [
    { dim: "temperature", label: "°C", toBase: (v) => v + 273.15, fromBase: (v) => v - 273.15 },
    ["c", "°c", "degc", "deg c", "celsius", "centigrade"],
  ],
  [
    { dim: "temperature", label: "°F", toBase: (v) => ((v - 32) * 5) / 9 + 273.15, fromBase: (v) => ((v - 273.15) * 9) / 5 + 32 },
    ["f", "°f", "degf", "deg f", "fahrenheit"],
  ],
  [{ dim: "temperature", label: "K", toBase: (v) => v, fromBase: (v) => v }, ["k", "kelvin"]],
];

// Data sizes, where case is the whole difference between a bit and a byte.
// Decimal (kB = 1000 B) and binary (KiB = 1024 B) are different units, as they
// are in real life. The lowercase forms people actually type ("mb", "gb") mean
// bytes; the capital-M-lowercase-b forms ("Mb", "Gb") are bits.
const DATA_EXACT: [string, Unit][] = [
  ["b", linear("data", "bit", 1 / 8)],
  ["bit", linear("data", "bit", 1 / 8)],
  ["bits", linear("data", "bit", 1 / 8)],
  ["B", linear("data", "B", 1)],
  ["byte", linear("data", "B", 1)],
  ["bytes", linear("data", "B", 1)],
  ["Kb", linear("data", "Kb", 1000 / 8)],
  ["Mb", linear("data", "Mb", 1e6 / 8)],
  ["Gb", linear("data", "Gb", 1e9 / 8)],
  ["Tb", linear("data", "Tb", 1e12 / 8)],
  ["kB", linear("data", "kB", 1e3)],
  ["KB", linear("data", "kB", 1e3)],
  ["MB", linear("data", "MB", 1e6)],
  ["GB", linear("data", "GB", 1e9)],
  ["TB", linear("data", "TB", 1e12)],
  ["PB", linear("data", "PB", 1e15)],
  ["KiB", linear("data", "KiB", 1024)],
  ["MiB", linear("data", "MiB", 1024 ** 2)],
  ["GiB", linear("data", "GiB", 1024 ** 3)],
  ["TiB", linear("data", "TiB", 1024 ** 4)],
  ["kilobyte", linear("data", "kB", 1e3)],
  ["kilobytes", linear("data", "kB", 1e3)],
  ["megabyte", linear("data", "MB", 1e6)],
  ["megabytes", linear("data", "MB", 1e6)],
  ["gigabyte", linear("data", "GB", 1e9)],
  ["gigabytes", linear("data", "GB", 1e9)],
  ["terabyte", linear("data", "TB", 1e12)],
  ["terabytes", linear("data", "TB", 1e12)],
  ["megabit", linear("data", "Mb", 1e6 / 8)],
  ["megabits", linear("data", "Mb", 1e6 / 8)],
  ["gigabit", linear("data", "Gb", 1e9 / 8)],
  ["gigabits", linear("data", "Gb", 1e9 / 8)],
  ["kibibyte", linear("data", "KiB", 1024)],
  ["mebibyte", linear("data", "MiB", 1024 ** 2)],
  ["gibibyte", linear("data", "GiB", 1024 ** 3)],
  // Case-sensitive power and pressure prefixes, where m and M are a factor of a billion apart.
  ["mW", linear("power", "mW", 1e-3)],
  ["MW", linear("power", "MW", 1e6)],
  ["GW", linear("power", "GW", 1e9)],
  ["mPa", linear("pressure", "mPa", 1e-3)],
  ["MPa", linear("pressure", "MPa", 1e6)],
  ["hPa", linear("pressure", "hPa", 100)],
];
const DATA_LOWER: [string, Unit][] = [
  ["kb", linear("data", "kB", 1e3)],
  ["mb", linear("data", "MB", 1e6)],
  ["gb", linear("data", "GB", 1e9)],
  ["tb", linear("data", "TB", 1e12)],
  ["kib", linear("data", "KiB", 1024)],
  ["mib", linear("data", "MiB", 1024 ** 2)],
  ["gib", linear("data", "GiB", 1024 ** 3)],
  ["tib", linear("data", "TiB", 1024 ** 4)],
];

const AMBIGUOUS: Record<string, string> = {
  ton: 'ambiguous — say "tonne" (metric), "short ton" (US) or "long ton" (UK)',
  tons: 'ambiguous — say "tonne" (metric), "short ton" (US) or "long ton" (UK)',
  calorie: 'ambiguous — say "cal" (small calorie) or "kcal" (the food Calorie)',
  calories: 'ambiguous — say "cal" (small calorie) or "kcal" (the food Calorie)',
  month: "not a fixed length of time",
  months: "not a fixed length of time",
};

const EXACT = new Map<string, Unit>(DATA_EXACT);
const LOWER = new Map<string, Unit>();
for (const [unit, names] of UNIT_LIST) for (const name of names) if (!LOWER.has(name)) LOWER.set(name, unit);
for (const [name, unit] of DATA_LOWER) LOWER.set(name, unit);

/** Find a unit by what someone typed, or null. */
export function lookupUnit(text: string): Unit | null {
  const trimmed = text.trim().replace(/\.$/, "").replace(/\s+/g, " ");
  if (!trimmed) return null;
  return EXACT.get(trimmed) ?? LOWER.get(trimmed.toLowerCase()) ?? null;
}

// "to" and friends. "in" is also the inch, so it is only a connector when
// nothing else is: "12 in in cm" works, "5 in to cm" splits at "to".
// The lookahead (not a trailing \s) keeps the match from eating the space the
// next "in" needs, which is what lets "12 in in cm" find its second "in".
const CONNECTORS: RegExp[] = [/\s(?:to|into|as)(?=\s)|\s*->\s*|\s*→\s*/gi, /\sin(?=\s)/gi];

function splitAtConnector(expression: string): [string, string] | null {
  for (const pattern of CONNECTORS) {
    let last: RegExpExecArray | null = null;
    for (const match of expression.matchAll(pattern)) last = match;
    if (last) return [expression.slice(0, last.index), expression.slice(last.index + last[0].length)];
  }
  return null;
}

const NOT_UNITS = new Set([
  "sqrt", "abs", "round", "floor", "ceil", "sin", "cos", "tan", "log", "log10", "exp", "pi",
]);

/**
 * Split "(2 + 3) km" into the arithmetic and the unit after it: the unit starts
 * at the first word that isn't a function, a constant, or the "e" of an exponent.
 */
function splitNumberAndUnit(side: string): { expr: string; unit: string } {
  const text = side.trim();
  const re = /[a-zA-Zµ°]+/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    const word = match[0];
    const before = text.slice(0, match.index);
    const isExponent =
      /^[eE]$/.test(word) && /[0-9.]$/.test(before) && /^[-+]?[0-9]/.test(text.slice(match.index + 1));
    if (isExponent || NOT_UNITS.has(word.toLowerCase())) continue;
    return { expr: before.trim(), unit: text.slice(match.index).trim() };
  }
  return { expr: text, unit: "" };
}

export interface Conversion {
  value: number;
  from: Unit;
  to: Unit;
  result: number;
}

/**
 * Whether `expression` asks for a conversion, and if so, do it.
 *
 * Returns null for anything that isn't shaped like one, so ordinary arithmetic
 * is untouched. Throws UnitError when it is clearly a conversion that can't be
 * done — an unknown unit, or length to mass — with a message the model can act on.
 */
export function parseConversion(expression: string, evaluate: (expr: string) => number): Conversion | null {
  const parts = splitAtConnector(expression.trim());
  if (!parts) return null;
  const [left, right] = parts;

  const { expr, unit: fromText } = splitNumberAndUnit(left);
  const to = lookupUnit(right);
  const from = fromText ? lookupUnit(fromText) : null;

  // Neither side names a unit: this isn't a conversion, leave it to the arithmetic.
  if (!to && !from) return null;

  for (const text of [fromText, right.trim()]) {
    const key = text.toLowerCase().replace(/\.$/, "");
    if (key in AMBIGUOUS) throw new UnitError(`"${text}" is ${AMBIGUOUS[key]}.`);
  }
  if (!fromText) throw new UnitError(`Say what unit the number is in, e.g. "5 km to mi".`);
  if (!from) throw new UnitError(`Unknown unit "${fromText}".`);
  if (!to) throw new UnitError(`Unknown unit "${right.trim()}".`);
  if (from.dim !== to.dim) {
    throw new UnitError(`Can't convert ${from.dim} (${from.label}) to ${to.dim} (${to.label}).`);
  }

  // "km to miles" with no number means one.
  const value = expr === "" ? 1 : evaluate(expr);
  const result = to.fromBase(from.toBase(value));
  if (!Number.isFinite(result)) throw new UnitError("Result is not a finite number.");
  return { value, from, to, result };
}

/** Seven significant digits, no exponent unless the number is very large or small. */
export function formatNumber(n: number): string {
  if (n === 0) return "0";
  const abs = Math.abs(n);
  if (abs >= 1e15 || abs < 1e-6) return n.toExponential(6).replace(/\.?0+e/, "e");
  return String(Number(n.toPrecision(7)));
}

export function describeConversion(c: Conversion): string {
  return `${formatNumber(c.value)} ${c.from.label} = ${formatNumber(c.result)} ${c.to.label}`;
}

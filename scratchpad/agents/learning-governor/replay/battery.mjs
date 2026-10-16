/**
 * Compare the native battery sysfs probe with the app's BatteryManager push
 * (OPEN 4): are both readable, do the temperatures agree within 0.5 C, and
 * does the sysfs status agree with `plugged`.
 */

/** Android battery status strings the binding encodes (DESIGN 3.1): 1
 *  Charging, 2 Discharging, 3 Not charging, 4 Full. */
const CHARGING_STATUS = new Set([1, 4]);

export function compareBattery(rows) {
  const tempOk = rows.filter((row) => row.bsys[0] === 1);
  const statusOk = rows.filter((row) => row.bsys[2] === 1);
  const tempRows = tempOk.filter((row) => typeof row.bsys[1] === "number");
  const statusRows = statusOk.filter((row) => typeof row.bsys[3] === "number");
  const tempDeltas = tempRows.map((row) => Math.abs(row.bsys[1] - row.batt) / 10);
  const statusAgreements = statusRows.filter(
    (row) => CHARGING_STATUS.has(row.bsys[3]) === (row.plugged === 1),
  );
  const withinHalfC = tempDeltas.filter((delta) => delta <= 0.5).length;
  const agreementPct = statusRows.length > 0 ? statusAgreements.length / statusRows.length : null;
  const withinHalf = withinHalfC === tempRows.length;
  const statusAgrees = agreementPct !== null && agreementPct >= 0.95;

  // WHY both probes are required: OPEN 4's criterion is the AND of the two
  // comparisons, so a row set where only one probe ever answered has half of
  // the criterion, not all of it.
  const verdict =
    tempRows.length === 0 && statusRows.length === 0
      ? "OPEN 4 answered negatively on these rows: the probe read neither value"
      : tempRows.length === 0
        ? `status readable and ${statusAgrees ? "agreeing" : "disagreeing"}, temperature unreadable: the combined criterion is untested`
        : statusRows.length === 0
          ? `temperature readable and ${withinHalf ? "within 0.5 C" : "outside 0.5 C"}, status unreadable: the combined criterion is untested`
          : withinHalf && statusAgrees
            ? "sysfs and BatteryManager agree on every comparable row"
            : "sysfs and BatteryManager disagree";

  return {
    rows: rows.length,
    tempOk: tempOk.length,
    statusOk: statusOk.length,
    tempCompared: tempRows.length,
    maxTempDeltaC: tempDeltas.length > 0 ? Math.max(...tempDeltas) : null,
    withinHalfC,
    statusCompared: statusRows.length,
    statusAgreed: statusAgreements.length,
    agreementPct,
    verdict,
  };
}
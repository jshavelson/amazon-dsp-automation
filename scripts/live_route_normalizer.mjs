const iso = (value) => value ? new Date(value).toISOString() : null;

function routeStatus(transporter, progress) {
  if (transporter.driverSessionEnded || transporter.itineraryStatus === 'COMPLETED') return 'completed';
  if ((progress.completedStops || 0) > 0 || transporter.actualRouteDepartureTime) return 'in_progress';
  return 'assigned';
}

export function normalizeRouteSummaries(payload, { tenant = 'jecs', capturedAt = new Date().toISOString(), deliveryDate } = {}) {
  const capturedMs = Date.parse(capturedAt);
  const rows = [];
  for (const summary of payload?.rmsRouteSummaries || []) {
    for (const transporter of summary.transporters || []) {
      const progress = transporter.routeDeliveryProgress || {};
      const totalStops = Number(progress.totalStops ?? summary.totalStops ?? 0);
      const completedStops = Number(progress.completedStops ?? 0);
      const packages = progress.routePackageSummary || {};
      const deliveredPackages = Number(packages.DELIVERED ?? progress.completedDeliveries ?? 0);
      const remainingPackages = Number(packages.REMAINING ?? 0);
      const totalPackages = deliveredPackages + remainingPackages;
      const status = routeStatus(transporter, progress);
      const plannedDepartureMs = Number(summary.plannedDepartureTime || 0);
      const actualDepartureMs = Number(transporter.actualRouteDepartureTime || 0);
      const lastEventMs = Number(transporter.lastDriverEventTime || transporter.lastVehicleMovementTime || 0);
      const projectedCompletionMs = Number(transporter.projectedCompletionTime || 0);
      const scheduledEndMs = Number(transporter.scheduleEndTime || 0);
      const lateDepartureMinutes = plannedDepartureMs && actualDepartureMs
        ? Math.max(0, Math.round((actualDepartureMs - plannedDepartureMs) / 60000)) : 0;
      const inactiveMinutes = lastEventMs && status === 'in_progress'
        ? Math.max(0, Math.round((capturedMs - lastEventMs) / 60000)) : 0;
      const completionPct = totalStops ? Math.round((completedStops / totalStops) * 1000) / 10 : 0;
      const projectedLateMinutes = projectedCompletionMs && scheduledEndMs
        ? Math.max(0, Math.round((projectedCompletionMs - scheduledEndMs) / 60000)) : 0;
      const stalled = status === 'in_progress' && inactiveMinutes >= 45;
      const behind = status === 'in_progress' && (projectedLateMinutes >= 15 || Number(transporter.timeRemainingSecs || 0) < -900);
      const risk = stalled ? 'stalled' : behind ? 'behind' : lateDepartureMinutes >= 15 ? 'late_departure' : 'on_track';
      const associatedRoutes = (transporter.associatedRoutes || []).map((route) => ({
        routeId: route.routeId || '', routeCode: route.routeCode || route.routeId || ''
      }));
      rows.push({
        tenant,
        routeId: summary.routeId || transporter.routeId || transporter.itineraryId,
        routeCode: summary.routeCode || summary.routeId || 'Unknown',
        deliveryDate: deliveryDate || (summary.localDate || []).join('-'),
        transporterId: transporter.transporterId || '',
        driverName: transporter.transporterName || '',
        vin: transporter.vin || '',
        status,
        risk,
        plannedDepartureAt: iso(plannedDepartureMs),
        actualDepartureAt: iso(actualDepartureMs),
        projectedCompletionAt: iso(projectedCompletionMs),
        scheduledEndAt: iso(scheduledEndMs),
        lastEventAt: iso(lastEventMs),
        totalStops,
        completedStops,
        remainingStops: Math.max(0, totalStops - completedStops),
        completionPct,
        totalPackages,
        deliveredPackages,
        remainingPackages,
        stopsLastHour: Number(transporter.completedStopsInLastHour || 0),
        lateDepartureMinutes,
        projectedLateMinutes,
        inactiveMinutes,
        onBreak: transporter.currentBreakStatus === 'ON',
        routePaused: transporter.routePauseStatus === 'PAUSED',
        rescueCount: (transporter.rescueActions || []).length,
        associatedRoutes,
        isMultiRoute: associatedRoutes.length > 1,
        capturedAt,
      });
    }
  }
  const unique = [...new Map(rows.map((row) => [`${row.routeId}|${row.transporterId}`, row])).values()];
  const counts = (name) => unique.filter((row) => row[name]).length;
  const easternToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
  return {
    period: deliveryDate || unique[0]?.deliveryDate || null,
    capturedAt,
    source: 'Amazon Delivery Execution',
    connected: true,
    live: true,
    stale: deliveryDate !== easternToday || capturedMs < Date.now() - 15 * 60 * 1000,
    needsData: unique.length === 0,
    message: unique.length === 0 ? 'Amazon is connected, but no routes have been published for this operating day yet.' : null,
    needsReauth: false,
    routeCount: unique.length,
    summary: {
      assigned: unique.filter((row) => row.status === 'assigned').length,
      inProgress: unique.filter((row) => row.status === 'in_progress').length,
      completed: unique.filter((row) => row.status === 'completed').length,
      behind: unique.filter((row) => row.risk === 'behind').length,
      stalled: unique.filter((row) => row.risk === 'stalled').length,
      lateDepartures: unique.filter((row) => row.risk === 'late_departure').length,
      multiRoute: counts('isMultiRoute'),
    },
    routes: unique,
  };
}

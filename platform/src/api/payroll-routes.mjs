/**
 * Payroll API Routes
 */

import { getTimecards, getDisputeCandidates } from '../services/scorecard-data-service.mjs';

export function payrollRoutes(app, { repository, logger }) {

  /**
   * GET /api/payroll
   * Get payroll data - formatted for dashboard compatibility
   */
  app.get('/api/payroll', async (request, reply) => {
    const { tenantContext } = request;
    const { week, period } = request.query;
    
    try {
      // Try to get real timecard data
      const timecardData = await getTimecards(week);
      
      if (timecardData.timecards && timecardData.timecards.length > 0) {
        const timecards = timecardData.timecards.map(tc => ({
          id: tc.id || [tc.driverId || tc.driver_id, tc.week || week, tc.date].filter(Boolean).join('-'),
          driver_id: tc.driverId || tc.driver_id || '',
          driver_name: tc.driverName || tc.driver_name || '',
          week: tc.week || timecardData.week || week || null,
          hours: (tc.regularHours || tc.regular_hours || 0) + (tc.overtimeHours || tc.overtime_hours || 0),
          regular_hours: tc.regularHours || tc.regular_hours || 0,
          overtime_hours: tc.overtimeHours || tc.overtime_hours || 0,
          regular_earnings: tc.regularEarnings || tc.regular_earnings || 0,
          overtime_earnings: tc.overtimeEarnings || tc.overtime_earnings || 0,
          total_earnings: (tc.regularEarnings || tc.regular_earnings || 0) + (tc.overtimeEarnings || tc.overtime_earnings || 0),
          status: tc.status || 'pending',
          submitted_date: tc.submittedDate || tc.submitted_date || null,
          approved_date: tc.approvedDate || tc.approved_date || null
        }));
        
        return reply.send({
          week: timecardData.week || week || null,
          period: period || 'weekly',
          timecards,
          summary: {
            totalDrivers: timecards.length,
            totalRegularHours: timecards.reduce((sum, t) => sum + (t.regular_hours || 0), 0),
            totalOvertimeHours: timecards.reduce((sum, t) => sum + (t.overtime_hours || 0), 0),
            totalEarnings: timecards.reduce((sum, t) => sum + (t.total_earnings || 0), 0),
            averageEarnings: timecards.reduce((sum, t) => sum + (t.total_earnings || 0), 0) / timecards.length
          }
        });
      }
      
      // Fallback to database timecards
      const timecardsResult = await repository.listTimecards(tenantContext, { week, limit: 100 });
      
      if (timecardsResult.items && timecardsResult.items.length > 0) {
        const timecards = timecardsResult.items.map(tc => ({
          id: tc.id,
          driver_id: tc.driverId,
          driver_name: tc.driverName || '',
          week: tc.week || week || null,
          hours: (tc.regularHours || 0) + (tc.overtimeHours || 0),
          regular_hours: tc.regularHours || 0,
          overtime_hours: tc.overtimeHours || 0,
          regular_earnings: tc.regularEarnings || 0,
          overtime_earnings: tc.overtimeEarnings || 0,
          total_earnings: (tc.regularEarnings || 0) + (tc.overtimeEarnings || 0),
          status: tc.status || 'pending',
          submitted_date: tc.submittedDate || null,
          approved_date: tc.approvedDate || null
        }));
        
        return reply.send({
          week: week || timecards[0]?.week || null,
          period: period || 'weekly',
          timecards,
          summary: {
            totalDrivers: timecards.length,
            totalRegularHours: timecards.reduce((sum, t) => sum + (t.regular_hours || 0), 0),
            totalOvertimeHours: timecards.reduce((sum, t) => sum + (t.overtime_hours || 0), 0),
            totalEarnings: timecards.reduce((sum, t) => sum + (t.total_earnings || 0), 0),
            averageEarnings: timecards.reduce((sum, t) => sum + (t.total_earnings || 0), 0) / timecards.length
          }
        });
      }
      
      return reply.send({
        week: week || timecardData.week,
        period: period || 'weekly',
        timecards: [],
        needsData: true,
        source: 'ADP Workforce Now',
        sourceStatus: 'No tenant-scoped timecards have been ingested',
        summary: {
          totalDrivers: 0, totalRegularHours: 0, totalOvertimeHours: 0,
          totalEarnings: 0, averageEarnings: 0
        }
      });
    } catch (error) {
      request.log?.warn?.({ err: error }, 'payroll source unavailable; returning explicit needs-data state');
      return reply.send({
        week: week || null,
        period: period || 'weekly',
        timecards: [],
        needsData: true,
        source: 'ADP Workforce Now',
        sourceStatus: 'No tenant-scoped payroll register has been ingested',
        summary: {
          totalDrivers: 0, totalRegularHours: 0, totalOvertimeHours: 0,
          totalEarnings: 0, averageEarnings: 0
        }
      });
    }
  });

  /**
   * GET /api/payroll/discrepancies
   * Get payroll discrepancies - returns array for dashboard compatibility
   */
  app.get('/api/payroll/discrepancies', async (request, reply) => {
    const { tenantContext } = request;
    const { week } = request.query;
    
    try {
      // Try to get real discrepancies from dispute files
      const disputeData = await getDisputeCandidates(week);
      
      if (disputeData.disputes && disputeData.disputes.length > 0) {
        const discrepancies = disputeData.disputes.map((d, index) => ({
          id: `DISC-${index + 1}`,
          driver_id: d.driverId || '',
          driver_name: d.driverName || d.title || '',
          week: disputeData.week || week || null,
          date: d.date || null,
          adp_hours: d.adpHours ?? null,
          route_hours: d.routeHours ?? null,
          issue: d.reason || d.details?.join(' ') || '',
          severity: d.priority || 'medium',
          type: d.metric || 'other'
        }));
        
        return reply.send(discrepancies);
      }
      
      return reply.send([]);
    } catch (error) {
      request.log?.warn?.({ err: error }, 'payroll discrepancy source unavailable; returning empty result');
      return reply.send([]);
    }
  });
}

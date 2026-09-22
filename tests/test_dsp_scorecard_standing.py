import unittest
import sys
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1] / 'scripts'
sys.path.insert(0, str(SCRIPTS))

from jecs_api_server import _dsp_scorecard_standing, build_performance_dashboard_payload


class DspScorecardStandingTests(unittest.TestCase):
    def test_week_37_uses_official_dsp_scorecard(self):
        standing = _dsp_scorecard_standing('2026-wk37')
        self.assertEqual(standing['score'], 95.4)
        self.assertEqual(standing['tier'], 'Fantastic Plus')
        self.assertIn('DSPScorecard.pdf', standing['source'])

    def test_history_uses_the_latest_republished_scorecard(self):
        payload = build_performance_dashboard_payload()
        history = {row['period']: row for row in payload['history']}
        latest_period = payload['period']
        latest_standing = _dsp_scorecard_standing(latest_period)
        self.assertEqual(payload['dspPerformance']['overallScore'], latest_standing['score'])
        self.assertEqual(history[latest_period]['overallScore'], latest_standing['score'])
        self.assertIn('efficiencyScore', payload['dspPerformance'])
        self.assertIn('complianceScore', payload['dspPerformance'])
        self.assertIsNone(payload['dspPerformance']['efficiencyScore'])
        self.assertIsNone(payload['dspPerformance']['complianceScore'])
        self.assertEqual(history['2026-wk37']['overallScore'], 95.4)
        self.assertAlmostEqual(history['2026-wk37']['averageDaScore'], 96.32135802469134)
        self.assertEqual(history['2026-wk26']['overallScore'], 92.9)
        self.assertEqual(history['2026-wk26']['overallStanding'], 'Fantastic Plus')
        self.assertIn('Republish_20260812_160359', history['2026-wk26']['dspScoreSource'])


if __name__ == '__main__':
    unittest.main()

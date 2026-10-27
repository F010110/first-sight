"""Create a separately built instrumented upstream driver; vendor remains unchanged."""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main():
    source = ROOT / 'vendor/open-vins/ov_msckf/src/run_simulation.cpp'
    text = source.read_text(encoding='utf-8')
    marker = '      sys->feed_measurement_simulation(buffer_timecam, buffer_camids, buffer_feats);'
    if text.count(marker) != 1:
        raise ValueError('Upstream driver changed; audit insertion point')
    text = text.replace('#include <csignal>', '#include <csignal>\n#include <fstream>\n#include <iomanip>\n#include "state/State.h"')
    initialization = '''
  // Research adapter: argv[2] output CSV. No credentials or API involved.
  if (argc < 3) return EXIT_FAILURE;
  std::ofstream research_csv(argv[2]);
  if (!research_csv) return EXIT_FAILURE;
  research_csv << std::setprecision(17);
  research_csv << "t,est_px,est_py,est_pz,est_qx,est_qy,est_qz,est_qw,gt_qx,gt_qy,gt_qz,gt_qw,gt_px,gt_py,gt_pz\\n";
'''
    text = text.replace('  // Verbosity\n', initialization + '\n  // Verbosity\n', 1)
    export = '''
      auto research_state = sys->get_state();
      Eigen::Matrix<double,17,1> research_gt;
      // Filter timestamp is camera-clock time; GT spline is IMU-clock time.
      const double research_imu_time = research_state->_timestamp + sim->get_true_parameters().calib_camimu_dt;
      if (sim->get_state(research_imu_time, research_gt)) {
        auto p = research_state->_imu->pos();
        auto q = research_state->_imu->quat();
        research_csv << research_state->_timestamp;
        for (int i=0;i<3;i++) research_csv << "," << p(i);
        for (int i=0;i<4;i++) research_csv << "," << q(i);
        for (int i=1;i<=7;i++) research_csv << "," << research_gt(i);
        research_csv << "\\n";
      }
'''
    text = text.replace(marker, marker + '\n' + export)
    output = ROOT / 'runs/openvins-driver'
    output.mkdir(parents=True, exist_ok=True)
    (output / 'run_simulation_export.cpp').write_text(text, encoding='utf-8')
    (ROOT / 'reports/openvins-driver-adapter.json').write_text(json.dumps({
        'upstreamSha256': hashlib.sha256(source.read_bytes()).hexdigest(),
        'adapterSha256': hashlib.sha256(text.encode()).hexdigest(),
        'scope': 'adds per-camera-update causal estimated and GT pose CSV; original initialization retained',
        'status': 'generated only; compilation and CSV format require validation',
        'quaternion': 'upstream JPL q_GtoI, not camera-to-world; convert explicitly before memory input'
    }, indent=2), encoding='utf-8')
    print(output)


if __name__ == '__main__':
    main()

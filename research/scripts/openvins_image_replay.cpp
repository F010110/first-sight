// Offline, actual-image OpenVINS adapter. No GT initialization or simulator features.
// Usage: research_image_replay config.yaml imu.csv cameras.csv poses.csv
// imu.csv: t,wx,wy,wz,ax,ay,az (seconds, rad/s, m/s^2 specific force)
// cameras.csv: t,image0[,image1]; relative paths resolve against cameras.csv.
#include <cmath>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <limits>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>
#include <opencv2/imgcodecs.hpp>
#include "core/VioManager.h"
#include "state/State.h"
#include "utils/print.h"
#include "utils/sensor_data.h"

namespace fs = std::filesystem;

std::vector<std::string> split(const std::string &line) {
  std::vector<std::string> values;
  std::istringstream in(line);
  std::string part;
  while (std::getline(in, part, ',')) {
    if (!part.empty() && part.back() == '\r') part.pop_back();
    values.push_back(part);
  }
  return values;
}

std::vector<std::vector<std::string>> read_csv(const fs::path &path) {
  std::ifstream in(path);
  if (!in) throw std::runtime_error("Cannot read " + path.string());
  std::vector<std::vector<std::string>> rows;
  std::string line;
  double last = -std::numeric_limits<double>::infinity();
  while (std::getline(in, line)) {
    if (line.empty() || line[0] == '#' || line.rfind("t,", 0) == 0) continue;
    auto row = split(line);
    const double t = std::stod(row.at(0));
    if (!std::isfinite(t) || t <= last) throw std::runtime_error("Non-increasing timestamps: " + path.string());
    last = t;
    rows.push_back(std::move(row));
  }
  if (rows.empty()) throw std::runtime_error("Empty sensor stream: " + path.string());
  return rows;
}

int main(int argc, char **argv) {
  if (argc != 5) {
    std::cerr << "Usage: research_image_replay config.yaml imu.csv cameras.csv poses.csv\n";
    return 2;
  }
  try {
    auto imu = read_csv(argv[2]);
    auto cams = read_csv(argv[3]);
    auto parser = std::make_shared<ov_core::YamlParser>(argv[1]);
    ov_core::Printer::setPrintLevel("WARNING");
    ov_msckf::VioManagerOptions params;
    params.print_and_load(parser);
    params.num_opencv_threads = 0;
    params.use_multi_threading_pubs = false;
    params.use_multi_threading_subs = false;
    if (!parser->successful()) throw std::runtime_error("Invalid estimator configuration");
    auto sys = std::make_shared<ov_msckf::VioManager>(params);
    std::ofstream out(argv[4]);
    if (!out) throw std::runtime_error("Cannot open pose output");
    out << std::setprecision(17);
    out << "camera_t,imu_watermark_t,initialized,state_t,px,py,pz,q_GtoI_x,q_GtoI_y,q_GtoI_z,q_GtoI_w\n";
    size_t k = 0, initialized_count = 0;
    double watermark = -1.;
    const double time_offset = params.calib_camimu_dt;
    for (const auto &frame : cams) {
      const double t = std::stod(frame.at(0));
      if (frame.size() != static_cast<size_t>(params.state_options.num_cameras + 1))
        throw std::runtime_error("Camera columns do not match max_cameras");
      const double target = t + time_offset;
      // One IMU sample beyond image time permits bracketing interpolation. The
      // availability watermark is exported, so latency is explicit, not hidden.
      while (k < imu.size() && (watermark <= target || watermark < 0.)) {
        const auto &row = imu[k++];
        if (row.size() != 7) throw std::runtime_error("IMU row must have 7 columns");
        ov_core::ImuData msg;
        msg.timestamp = std::stod(row[0]);
        for (int i = 0; i < 3; ++i) {
          msg.wm(i) = std::stod(row[i+1]);
          msg.am(i) = std::stod(row[i+4]);
          if (!std::isfinite(msg.wm(i)) || !std::isfinite(msg.am(i)))
            throw std::runtime_error("Non-finite IMU measurement");
        }
        sys->feed_measurement_imu(msg);
        watermark = msg.timestamp;
      }
      if (watermark <= target) throw std::runtime_error("IMU stream does not bracket camera timestamp");
      ov_core::CameraData camera;
      camera.timestamp = t;
      for (size_t i = 1; i < frame.size(); ++i) {
        fs::path image_path(frame[i]);
        if (image_path.is_relative()) image_path = fs::path(argv[3]).parent_path()/image_path;
        cv::Mat image = cv::imread(image_path.string(), cv::IMREAD_GRAYSCALE);
        if (image.empty()) throw std::runtime_error("Unreadable image: " + image_path.string());
        camera.sensor_ids.push_back(static_cast<int>(i-1));
        camera.images.push_back(image);
        camera.masks.push_back(cv::Mat::zeros(image.size(), CV_8UC1));
      }
      sys->feed_measurement_camera(camera);
      const bool initialized = sys->initialized();
      auto state = sys->get_state();
      out << t << ',' << watermark << ',' << initialized << ',' << state->_timestamp;
      if (initialized) {
        auto p = state->_imu->pos();
        auto q = state->_imu->quat();
        for (int i=0; i<3; ++i) out << ',' << p(i);
        for (int i=0; i<4; ++i) out << ',' << q(i);
        ++initialized_count;
      } else {
        out << ",nan,nan,nan,nan,nan,nan,nan";
      }
      out << '\n';
      out.flush();
    }
    std::cout << "camera_frames=" << cams.size() << " initialized_outputs=" << initialized_count
              << " imu_samples=" << k << '\n';
    return initialized_count ? 0 : 3; // Initialization failure remains explicit.
  } catch (const std::exception &error) {
    std::cerr << "Replay error: " << error.what() << '\n';
    return 1;
  }
}

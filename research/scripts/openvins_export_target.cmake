# Included by CMake after project(); upstream files remain unchanged.
add_executable(research_sim_export "${CMAKE_CURRENT_LIST_DIR}/../runs/openvins-driver/run_simulation_export.cpp")
target_link_libraries(research_sim_export ov_msckf_lib)

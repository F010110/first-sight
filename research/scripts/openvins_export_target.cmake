# Included by CMake after project(); upstream files remain unchanged.
add_executable(research_sim_export "${CMAKE_CURRENT_LIST_DIR}/../runs/openvins-driver/run_simulation_export.cpp")
target_link_libraries(research_sim_export ov_msckf_lib)

# Real image tracking adapter, distinct from the synthetic-feature simulator.
add_executable(research_image_replay "${CMAKE_CURRENT_LIST_DIR}/openvins_image_replay.cpp")
set_property(TARGET research_image_replay PROPERTY CXX_STANDARD 17)
target_link_libraries(research_image_replay ov_msckf_lib)

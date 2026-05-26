clc; close all; clear;

% ********************************
% *                              *
% *      1. USER INPUT AREA      *
% *                              *
% ********************************

mu = 398600.4418;       % km^3/s^2
R_earth = 6371;         % km

% Orbit plane angles
Omega_deg = 80;         % RAAN, right ascension of ascending node [deg]
omega_deg = 30;         % Argument of periapsis / in-plane reference [deg]
i_deg     = 50;         % Inclination [deg]

% Search time range
t_search = 0:1:2*24*3600;      % seconds

% Test orbit radii
r_spacecraft = R_earth + 5000;     % km
r_Alien      = R_earth + 550;      % km

% Initial phase angles in PQW
f_spacecraft_0 = deg2rad(80);      % rad
f_Alien_0      = deg2rad(0);       % rad

% Orbit direction
dir = 1;                           % +1: counterclockwise, -1: clockwise


%% Initial state setup

[vec_r_spacecraft_0_PQW, vec_v_spacecraft_0_PQW] = ...
    circularStatePQW(r_spacecraft, f_spacecraft_0, dir, mu);

[vec_r_Alien_0_PQW, vec_v_Alien_0_PQW] = ...
    circularStatePQW(r_Alien, f_Alien_0, dir, mu);


%% PQW to ECI setup

Q_ECI_from_PQW = rotationPQWToECI( ...
    deg2rad(Omega_deg), ...
    deg2rad(omega_deg), ...
    deg2rad(i_deg));

vec_r_spacecraft_0_ECI = Q_ECI_from_PQW * vec_r_spacecraft_0_PQW;
vec_v_spacecraft_0_ECI = Q_ECI_from_PQW * vec_v_spacecraft_0_PQW;

vec_r_Alien_0_ECI = Q_ECI_from_PQW * vec_r_Alien_0_PQW;
vec_v_Alien_0_ECI = Q_ECI_from_PQW * vec_v_Alien_0_PQW;


%% Solve Hohmann rendezvous

[result, plotData] = solveHohmannRendezvousECI( ...
    vec_r_spacecraft_0_ECI, vec_v_spacecraft_0_ECI, ...
    vec_r_Alien_0_ECI, vec_v_Alien_0_ECI, ...
    mu, R_earth, ...
    Omega_deg, omega_deg, i_deg, ...
    t_search);


%% Result output

fprintf('\n========== Hohmann Rendezvous Result ==========\n');

fprintf('Omega = %.3f deg\n', Omega_deg);
fprintf('omega = %.3f deg\n', omega_deg);
fprintf('i     = %.3f deg\n', i_deg);

fprintf('\nr_start = %.3f km\n', result.r_start);
fprintf('r_target = %.3f km\n', result.r_target);
fprintf('a_transfer = %.3f km\n', result.a_transfer);
fprintf('t_H = %.3f s = %.3f min\n', result.t_H, result.t_H/60);

fprintf('\nt_burning1 = %.3f s = %.3f min\n', ...
    result.t_burning1, result.t_burning1/60);

fprintf('t_burning2 = %.3f s = %.3f min\n', ...
    result.t_burning2, result.t_burning2/60);

fprintf('\nposition1_ECI = r_Burn1 [km] = \n');
disp(result.position1_ECI.');

fprintf('position2_ECI = r_Burn2 [km] = \n');
disp(result.position2_ECI.');

fprintf('Alien position at Burn 1 [km] = \n');
disp(result.alien_position_burn1_ECI.');

fprintf('Alien position at Arrival [km] = \n');
disp(result.alien_position_arrival_ECI.');

fprintf('\nvec_delta_v_1_ECI [km/s] = \n');
disp(result.vec_delta_v_1_ECI.');

fprintf('norm_delta_v_1 = %.6f km/s\n', result.norm_delta_v_1);

fprintf('vec_delta_v_2_ECI [km/s] = \n');
disp(result.vec_delta_v_2_ECI.');

fprintf('norm_delta_v_2 = %.6f km/s\n', result.norm_delta_v_2);

fprintf('\nTotal delta-v = %.6f km/s\n', ...
    result.norm_delta_v_1 + result.norm_delta_v_2);

fprintf('min phase error = %.6e rad\n', result.min_phase_error);


%% Plot

plotHohmannRendezvousWhite(plotData);


%% Main solver function

function [result, plotData] = solveHohmannRendezvousECI( ...
    vec_r_spacecraft_0_ECI, vec_v_spacecraft_0_ECI, ...
    vec_r_Alien_0_ECI, vec_v_Alien_0_ECI, ...
    mu, R_earth, ...
    Omega_deg, omega_deg, i_deg, ...
    t_search)

    Omega = deg2rad(Omega_deg);
    omega = deg2rad(omega_deg);
    inc   = deg2rad(i_deg);

    Q_ECI_from_PQW = rotationPQWToECI(Omega, omega, inc);
    Q_PQW_from_ECI = Q_ECI_from_PQW.';

    vec_r_spacecraft_0_ECI = vec_r_spacecraft_0_ECI(:);
    vec_v_spacecraft_0_ECI = vec_v_spacecraft_0_ECI(:);
    vec_r_Alien_0_ECI      = vec_r_Alien_0_ECI(:);
    vec_v_Alien_0_ECI      = vec_v_Alien_0_ECI(:);

    % ECI to PQW
    vec_r_spacecraft_0_PQW = Q_PQW_from_ECI * vec_r_spacecraft_0_ECI;
    vec_v_spacecraft_0_PQW = Q_PQW_from_ECI * vec_v_spacecraft_0_ECI;

    vec_r_Alien_0_PQW = Q_PQW_from_ECI * vec_r_Alien_0_ECI;
    vec_v_Alien_0_PQW = Q_PQW_from_ECI * vec_v_Alien_0_ECI;

    assert(abs(vec_r_spacecraft_0_PQW(3)) < 1e-6, ...
        'Spacecraft position is not on the selected PQW plane.');

    assert(abs(vec_r_Alien_0_PQW(3)) < 1e-6, ...
        'Alien position is not on the selected PQW plane.');

    % Hohmann basic setup
    r_start  = norm(vec_r_spacecraft_0_PQW);
    r_target = norm(vec_r_Alien_0_PQW);

    v_circular_start  = sqrt(mu / r_start);
    v_circular_target = sqrt(mu / r_target);

    a_transfer = (r_start + r_target) / 2;
    t_H = pi * sqrt(a_transfer^3 / mu);

    v_transfer_start = sqrt(mu * (2/r_start  - 1/a_transfer));
    v_transfer_end   = sqrt(mu * (2/r_target - 1/a_transfer));

    % Rendezvous timing
    [tBurnStart, info] = findBurnStartTime( ...
        vec_r_spacecraft_0_PQW, vec_v_spacecraft_0_PQW, ...
        vec_r_Alien_0_PQW, vec_v_Alien_0_PQW, ...
        t_H, t_search);

    tBurnEnd = tBurnStart + t_H;

    h = cross(vec_r_spacecraft_0_PQW, vec_v_spacecraft_0_PQW);
    dir = sign(h(3));

    assert(dir ~= 0, 'Cannot determine orbital direction.');

    f_burn = info.f_spacecraft_burn;
    f_arrival = f_burn + dir*pi;

    f_Alien_burn1 = trueAnomalyofObjectOnCircularOrbit( ...
        vec_r_Alien_0_PQW, vec_v_Alien_0_PQW, tBurnStart);

    f_Alien_arrival = trueAnomalyofObjectOnCircularOrbit( ...
        vec_r_Alien_0_PQW, vec_v_Alien_0_PQW, tBurnEnd);

    % Burn positions in PQW
    vec_r_burn1_PQW = r_start * [
        cos(f_burn);
        sin(f_burn);
        0
    ];

    vec_r_burn2_PQW = r_target * [
        cos(f_arrival);
        sin(f_arrival);
        0
    ];

    vec_r_Alien_burn1_PQW = r_target * [
        cos(f_Alien_burn1);
        sin(f_Alien_burn1);
        0
    ];

    vec_r_Alien_arrival_PQW = r_target * [
        cos(f_Alien_arrival);
        sin(f_Alien_arrival);
        0
    ];

    % Delta-v vectors in PQW
    e_theta_burn1 = dir * [
        -sin(f_burn);
         cos(f_burn);
         0
    ];

    e_theta_burn2 = dir * [
        -sin(f_arrival);
         cos(f_arrival);
         0
    ];

    vec_delta_v_1_PQW = ...
        (v_transfer_start - v_circular_start) * e_theta_burn1;

    vec_delta_v_2_PQW = ...
        (v_circular_target - v_transfer_end) * e_theta_burn2;

    % PQW to ECI
    vec_r_burn1_ECI = Q_ECI_from_PQW * vec_r_burn1_PQW;
    vec_r_burn2_ECI = Q_ECI_from_PQW * vec_r_burn2_PQW;

    vec_r_Alien_burn1_ECI = Q_ECI_from_PQW * vec_r_Alien_burn1_PQW;
    vec_r_Alien_arrival_ECI = Q_ECI_from_PQW * vec_r_Alien_arrival_PQW;

    vec_delta_v_1_ECI = Q_ECI_from_PQW * vec_delta_v_1_PQW;
    vec_delta_v_2_ECI = Q_ECI_from_PQW * vec_delta_v_2_PQW;

    % Result data
    result.t_burning1 = tBurnStart;
    result.t_burning2 = tBurnEnd;

    result.position1_ECI = vec_r_burn1_ECI;
    result.position2_ECI = vec_r_burn2_ECI;

    result.alien_position_burn1_ECI = vec_r_Alien_burn1_ECI;
    result.alien_position_arrival_ECI = vec_r_Alien_arrival_ECI;

    result.vec_delta_v_1_ECI = vec_delta_v_1_ECI;
    result.norm_delta_v_1 = norm(vec_delta_v_1_ECI);

    result.vec_delta_v_2_ECI = vec_delta_v_2_ECI;
    result.norm_delta_v_2 = norm(vec_delta_v_2_ECI);

    result.r_start = r_start;
    result.r_target = r_target;

    result.a_transfer = a_transfer;
    result.t_H = t_H;

    result.v_circular_start = v_circular_start;
    result.v_circular_target = v_circular_target;
    result.v_transfer_start = v_transfer_start;
    result.v_transfer_end = v_transfer_end;

    result.min_phase_error = info.min_phase_error;

    result.f_burn = f_burn;
    result.f_arrival = f_arrival;
    result.f_Alien_burn1 = f_Alien_burn1;
    result.f_Alien_arrival = f_Alien_arrival;

    result.Q_ECI_from_PQW = Q_ECI_from_PQW;
    result.Q_PQW_from_ECI = Q_PQW_from_ECI;

    % Build plot data
    plotData = buildHohmannPlotData( ...
        vec_r_spacecraft_0_PQW, ...
        vec_r_Alien_0_PQW, ...
        Q_ECI_from_PQW, ...
        r_start, r_target, ...
        f_burn, f_arrival, ...
        f_Alien_burn1, f_Alien_arrival, ...
        R_earth, dir);
end


%% Plot data builder

function plotData = buildHohmannPlotData( ...
    vec_r_spacecraft_0_PQW, ...
    vec_r_Alien_0_PQW, ...
    Q_ECI_from_PQW, ...
    r_start, r_target, ...
    f_burn, f_arrival, ...
    f_Alien_burn1, f_Alien_arrival, ...
    R_earth, dir)

    f_spacecraft_0 = atan2(vec_r_spacecraft_0_PQW(2), vec_r_spacecraft_0_PQW(1));

    % Initial orbit arc before Burn 1
    theta_init_arc = angleArc(f_spacecraft_0, f_burn, dir, 500);

    initialArc_PQW = [
        r_start * cos(theta_init_arc);
        r_start * sin(theta_init_arc);
        zeros(size(theta_init_arc))
    ];

    initialArc_ECI = Q_ECI_from_PQW * initialArc_PQW;

    % Transfer orbit arc
    s = linspace(0, pi, 800);

    a_transfer = (r_start + r_target) / 2;
    e_transfer = abs(r_target - r_start) / (r_start + r_target);
    p_transfer = a_transfer * (1 - e_transfer^2);

    if r_target > r_start
        % Raising transfer:
        % start = periapsis, end = apoapsis
        r_transfer = p_transfer ./ (1 + e_transfer * cos(s));
    else
        % Lowering transfer:
        % start = apoapsis, end = periapsis
        r_transfer = p_transfer ./ (1 - e_transfer * cos(s));
    end

    theta_transfer = f_burn + dir * s;

    transferArc_PQW = [
        r_transfer .* cos(theta_transfer);
        r_transfer .* sin(theta_transfer);
        zeros(size(theta_transfer))
    ];

    transferArc_ECI = Q_ECI_from_PQW * transferArc_PQW;

    % Full orbit references
    theta_full = linspace(0, 2*pi, 900);

    outer_r = max(r_start, r_target);

    outerOrbit_PQW = [
        outer_r * cos(theta_full);
        outer_r * sin(theta_full);
        zeros(size(theta_full))
    ];

    outerOrbit_ECI = Q_ECI_from_PQW * outerOrbit_PQW;

    % Final orbit
    finalOrbit_PQW = [
        r_target * cos(theta_full);
        r_target * sin(theta_full);
        zeros(size(theta_full))
    ];

    finalOrbit_ECI = Q_ECI_from_PQW * finalOrbit_PQW;

    % Key points
    spacecraftStart_PQW = vec_r_spacecraft_0_PQW(:);

    burn1_PQW = r_start * [
        cos(f_burn);
        sin(f_burn);
        0
    ];

    burn2_PQW = r_target * [
        cos(f_arrival);
        sin(f_arrival);
        0
    ];

    alienStart_PQW = vec_r_Alien_0_PQW(:);

    alienBurn1_PQW = r_target * [
        cos(f_Alien_burn1);
        sin(f_Alien_burn1);
        0
    ];

    alienArrival_PQW = r_target * [
        cos(f_Alien_arrival);
        sin(f_Alien_arrival);
        0
    ];

    % Plane reference axes
    P_axis_ECI = Q_ECI_from_PQW * [1; 0; 0];
    Q_axis_ECI = Q_ECI_from_PQW * [0; 1; 0];
    W_axis_ECI = Q_ECI_from_PQW * [0; 0; 1];

    % Build plot data
    plotData.R_earth = R_earth;

    plotData.outerOrbit_ECI  = outerOrbit_ECI;
    plotData.initialArc_ECI  = initialArc_ECI;
    plotData.transferArc_ECI = transferArc_ECI;
    plotData.finalOrbit_ECI  = finalOrbit_ECI;

    plotData.points.spacecraftStart_ECI = Q_ECI_from_PQW * spacecraftStart_PQW;
    plotData.points.burn1_ECI           = Q_ECI_from_PQW * burn1_PQW;
    plotData.points.burn2_ECI           = Q_ECI_from_PQW * burn2_PQW;

    plotData.points.alienStart_ECI      = Q_ECI_from_PQW * alienStart_PQW;
    plotData.points.alienBurn1_ECI      = Q_ECI_from_PQW * alienBurn1_PQW;
    plotData.points.alienArrival_ECI    = Q_ECI_from_PQW * alienArrival_PQW;

    plotData.planeAxes.P_axis_ECI = P_axis_ECI;
    plotData.planeAxes.Q_axis_ECI = Q_axis_ECI;
    plotData.planeAxes.W_axis_ECI = W_axis_ECI;

    plotData.axisLength = 1.25 * max(r_start, r_target);
end


%% Pure plot function

function plotHohmannRendezvousWhite(plotData)
    % Pure plot function.
    % This function only draws prepared plotData.

    figure('Color', 'w');
    hold on;
    axis equal;
    grid on;
    view(3);

    L = plotData.axisLength;

    xlim([-L L]);
    ylim([-L L]);
    zlim([-L L]);

    ax = gca;
    ax.Color = 'w';
    ax.XColor = 'k';
    ax.YColor = 'k';
    ax.ZColor = 'k';
    ax.GridColor = [0.75, 0.75, 0.75];
    ax.LineWidth = 1.1;
    ax.FontSize = 12;

    title('3D Hohmann Transfer Rendezvous Geometry', 'Color', 'k');
    xlabel('x_{ECI} [km]', 'Color', 'k');
    ylabel('y_{ECI} [km]', 'Color', 'k');
    zlabel('z_{ECI} [km]', 'Color', 'k');

    % Earth
    if isfield(plotData, 'R_earth') && plotData.R_earth > 0
        [xe, ye, ze] = sphere(80);

        surf(plotData.R_earth * xe, ...
             plotData.R_earth * ye, ...
             plotData.R_earth * ze, ...
            'FaceColor', [0.45, 0.65, 1.00], ...
            'FaceAlpha', 0.35, ...
            'EdgeColor', 'none', ...
            'DisplayName', 'Earth');
    end

    % Orbit curves

    % Outer orbit reference: gray dashed
    plot3(plotData.outerOrbit_ECI(1,:), ...
          plotData.outerOrbit_ECI(2,:), ...
          plotData.outerOrbit_ECI(3,:), ...
          '--', ...
          'Color', [0.55, 0.55, 0.55], ...
          'LineWidth', 1.4, ...
          'DisplayName', 'Outer Orbit Reference');

    plot3(plotData.initialArc_ECI(1,:), ...
          plotData.initialArc_ECI(2,:), ...
          plotData.initialArc_ECI(3,:), ...
          '-', ...
          'Color', [1.0, 0.1, 0.1], ...
          'LineWidth', 3.0, ...
          'DisplayName', 'Initial Orbit Before Burn');

    plot3(plotData.transferArc_ECI(1,:), ...
          plotData.transferArc_ECI(2,:), ...
          plotData.transferArc_ECI(3,:), ...
          '-', ...
          'Color', [1.0, 0.75, 0.0], ...
          'LineWidth', 3.2, ...
          'DisplayName', 'Hohmann Transfer Orbit');

    plot3(plotData.finalOrbit_ECI(1,:), ...
          plotData.finalOrbit_ECI(2,:), ...
          plotData.finalOrbit_ECI(3,:), ...
          '--', ...
          'Color', [0.0, 0.65, 0.15], ...
          'LineWidth', 2.2, ...
          'DisplayName', 'Final Orbit');

    % Points
    plotPoint3(plotData.points.spacecraftStart_ECI, ...
        [1.0, 0.1, 0.1], 'o', 'Spacecraft Start');

    plotPoint3(plotData.points.burn1_ECI, ...
        [0.8, 0.0, 0.0], 'o', 'Burn 1');

    plotPoint3(plotData.points.burn2_ECI, ...
        [1.0, 0.75, 0.0], 's', 'Burn 2 / Transfer Arrival');

    plotPoint3(plotData.points.alienStart_ECI, ...
        [0.0, 0.45, 0.1], '^', 'Alien Start');

    plotPoint3(plotData.points.alienBurn1_ECI, ...
        [0.0, 0.75, 0.85], 'd', 'Alien at Burn 1');

    plotPoint3(plotData.points.alienArrival_ECI, ...
        [0.0, 0.65, 0.15], '^', 'Alien Arrival');

    % Burn position vectors
    plotPositionVector3(plotData.points.burn1_ECI, ...
        [0.8, 0.0, 0.0], 'r_{Burn 1}');

    plotPositionVector3(plotData.points.burn2_ECI, ...
        [0.9, 0.55, 0.0], 'r_{Burn 2}');

    % Plane reference axes
    plotPlaneAxis3(plotData.planeAxes.P_axis_ECI, ...
        0.65*L, [0.15, 0.15, 0.85], 'P axis');

    plotPlaneAxis3(plotData.planeAxes.Q_axis_ECI, ...
        0.65*L, [0.0, 0.55, 0.85], 'Q axis');

    plotPlaneAxis3(plotData.planeAxes.W_axis_ECI, ...
        0.65*L, [0.55, 0.0, 0.85], 'W / h axis');

    % Labels
    textPoint3(plotData.points.spacecraftStart_ECI, '  S/C Start');
    textPoint3(plotData.points.burn1_ECI, '  Burn 1');
    textPoint3(plotData.points.burn2_ECI, '  Burn 2');

    textPoint3(plotData.points.alienStart_ECI, '  Alien Start');
    textPoint3(plotData.points.alienBurn1_ECI, '  Alien at Burn 1');
    textPoint3(plotData.points.alienArrival_ECI, '  Alien Arrival');

    % ECI axes
    quiver3(0, 0, 0, L, 0, 0, ...
        'k', 'LineWidth', 1.2, 'MaxHeadSize', 0.35, ...
        'DisplayName', 'ECI x-axis');

    quiver3(0, 0, 0, 0, L, 0, ...
        'k', 'LineWidth', 1.2, 'MaxHeadSize', 0.35, ...
        'DisplayName', 'ECI y-axis');

    quiver3(0, 0, 0, 0, 0, L, ...
        'k', 'LineWidth', 1.2, 'MaxHeadSize', 0.35, ...
        'DisplayName', 'ECI z-axis');

    text(L, 0, 0, '  X_{ECI}', 'Color', 'k', 'FontSize', 11);
    text(0, L, 0, '  Y_{ECI}', 'Color', 'k', 'FontSize', 11);
    text(0, 0, L, '  Z_{ECI}', 'Color', 'k', 'FontSize', 11);

    legend_handle = legend('Location', 'best');
    legend_handle.TextColor = 'k';
    legend_handle.Color = 'w';
    legend_handle.EdgeColor = 'k';

    hold off;
end


function plotPoint3(vec, color, marker, displayName)
    vec = vec(:);

    plot3(vec(1), vec(2), vec(3), ...
        marker, ...
        'Color', color, ...
        'MarkerFaceColor', color, ...
        'MarkerSize', 9, ...
        'LineWidth', 1.8, ...
        'DisplayName', displayName);
end


function plotPositionVector3(vec, color, displayName)
    vec = vec(:);

    quiver3(0, 0, 0, ...
        vec(1), vec(2), vec(3), ...
        0, ...
        'Color', color, ...
        'LineWidth', 1.8, ...
        'MaxHeadSize', 0.18, ...
        'DisplayName', displayName);

    text(0.52*vec(1), 0.52*vec(2), 0.52*vec(3), ...
        ['  ', displayName], ...
        'Color', color, ...
        'FontSize', 11);
end


function plotPlaneAxis3(unitVec, lengthScale, color, displayName)
    unitVec = unitVec(:);

    vec = lengthScale * unitVec;

    quiver3(0, 0, 0, ...
        vec(1), vec(2), vec(3), ...
        0, ...
        'Color', color, ...
        'LineWidth', 2.0, ...
        'MaxHeadSize', 0.35, ...
        'DisplayName', displayName);

    text(vec(1), vec(2), vec(3), ...
        ['  ', displayName], ...
        'Color', color, ...
        'FontSize', 11);
end


function textPoint3(vec, labelText)
    vec = vec(:);

    text(vec(1), vec(2), vec(3), ...
        labelText, ...
        'Color', 'k', ...
        'FontSize', 11);
end


%% Rendezvous timing core

function [tBurnStart, info] = findBurnStartTime( ...
    vec_r_spacecraft_0, vec_v_spacecraft_0, ...
    vec_r_Alien_0, vec_v_Alien_0, ...
    t_H, t)

    t = t(:);

    h = cross(vec_r_spacecraft_0(:), vec_v_spacecraft_0(:));
    dir = sign(h(3));

    assert(dir ~= 0, 'Cannot determine orbital direction.');

    f_spacecraft_burn = trueAnomalyofObjectOnCircularOrbit( ...
        vec_r_spacecraft_0, vec_v_spacecraft_0, t);

    f_Alien_arrival = trueAnomalyofObjectOnCircularOrbit( ...
        vec_r_Alien_0, vec_v_Alien_0, t + t_H);

    f_transfer_arrival = f_spacecraft_burn + dir*pi;

    phase_error = atan2( ...
        sin(f_Alien_arrival - f_transfer_arrival), ...
        cos(f_Alien_arrival - f_transfer_arrival));

    phase_error_list = abs(phase_error);

    [min_phase_error, idx_min] = min(phase_error_list);

    tBurnStart = t(idx_min);

    info.idx_min = idx_min;
    info.min_phase_error = min_phase_error;
    info.phase_error_list = phase_error_list;

    info.f_spacecraft_burn = f_spacecraft_burn(idx_min);
    info.f_Alien_arrival = f_Alien_arrival(idx_min);
    info.f_transfer_arrival = f_transfer_arrival(idx_min);
end


function f = trueAnomalyofObjectOnCircularOrbit(vec_r_0, vec_v_0, t)
    vec_r_0 = vec_r_0(:);
    vec_v_0 = vec_v_0(:);

    r = norm(vec_r_0);
    v = norm(vec_v_0);

    assert(r > eps, 'Initial position vector cannot be zero.');
    assert(v > eps, 'Initial velocity vector cannot be zero.');

    assert(abs(dot(vec_r_0, vec_v_0)) < 1e-6 * r * v, ...
        'For circular orbit, position and velocity should be perpendicular.');

    f_0 = atan2(vec_r_0(2), vec_r_0(1));

    h = cross(vec_r_0, vec_v_0);

    assert(abs(h(3)) > eps, ...
        'Angular momentum z-component is too small. Cannot determine orbit direction.');

    dir = sign(h(3));

    omega = dir * v / r;

    f = f_0 + omega .* t;
end


%% Geometry helpers

function [vec_r_PQW, vec_v_PQW] = circularStatePQW(r, f, dir, mu)
    assert(r > 0, 'Orbit radius must be positive.');
    assert(dir == 1 || dir == -1, 'dir must be +1 or -1.');

    v = sqrt(mu / r);

    vec_r_PQW = r * [
        cos(f);
        sin(f);
        0
    ];

    vec_v_PQW = dir * v * [
        -sin(f);
         cos(f);
         0
    ];
end


function Q = rotationPQWToECI(Omega, omega, inc)
    % PQW -> ECI
    %
    % Q = R3(Omega) * R1(i) * R3(omega)

    R3_Omega = [
        cos(Omega), -sin(Omega), 0;
        sin(Omega),  cos(Omega), 0;
        0,           0,          1
    ];

    R1_inc = [
        1, 0,        0;
        0, cos(inc), -sin(inc);
        0, sin(inc),  cos(inc)
    ];

    R3_omega = [
        cos(omega), -sin(omega), 0;
        sin(omega),  cos(omega), 0;
        0,           0,          1
    ];

    Q = R3_Omega * R1_inc * R3_omega;
end


function theta_arc = angleArc(theta_start, theta_end, dir, N)
    theta_start = mod(theta_start, 2*pi);
    theta_end   = mod(theta_end, 2*pi);

    if dir > 0
        dtheta = mod(theta_end - theta_start, 2*pi);
        theta_arc = linspace(theta_start, theta_start + dtheta, N);
    else
        dtheta = mod(theta_start - theta_end, 2*pi);
        theta_arc = linspace(theta_start, theta_start - dtheta, N);
    end
end
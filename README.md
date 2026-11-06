# Lagrangia

*Robot dynamics & control playground.* Derive equations of motion with Lagrange, check them instantly, build controllers from Simulink-style blocks and watch them run in a live physics simulation.

Systems: **cart-pole**, **Furuta (rotary) pendulum**, **Franka FR3 / Panda 7-DOF arm**. UI in **English and Dutch**.

## Run

Requires Node.js 20+.

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # 95 tests: dynamics, interpreter, checker, controllers, export
npm run build      # static site in dist/
```

## Features

| Area | What you get |
|---|---|
| Simulation | Own dynamics engine (no black box). Closed-form Lagrangian dynamics for the pendulums (RK4, 1 kHz); RNEA for the 7-DOF arm (0.5 ms, semi-implicit). Drag bodies with the mouse (virtual spring mapped with Jᵀ), arrow keys, kick impulses. |
| Environment | Viscous / Coulomb (sign or tanh) / Stribeck friction, quadratic air drag, gravity, track end-stops, penalty contact with a table, block and wall (Franka), actuator saturation & delay, "realistic sensing" (noise, encoder quantisation, finite-difference velocities). |
| Controller editor | Simulink-like block diagram (~45 blocks: sources, math, routing, integrators/TF/state-space, PID, LQR, robotics M(q)/C(q,q̇)q̇/g(q)/FK/Jacobian, MATLAB Function, subsystems, scopes, sliders, 3D target gizmo). Model workspace / init script in MATLAB syntax (`lqr`, `A_lin`, `B_lin` available). Copy/paste, Ctrl+G grouping, algebraic-loop detection. |
| MATLAB Function block | Built-in MATLAB-subset interpreter: matrices, indexing incl. `end`, `if/for/while`, `persistent`, multiple outputs, ~70 built-ins. |
| Tutorials | Step-by-step derivations with LaTeX input (MathLive visual editor or raw LaTeX + preview). Every field has **Check**: numeric equivalence at random points, so any rearrangement or scaling is accepted. Diagnoses wrong signs, coefficients, missing/extra terms and wrong matrix entries. Matrix-valued checks for the arm use random matrices, so factor order and transposes matter. Hints, reveal solution, optional guided mode. |
| Ghost | Simulates *your* typed equations of motion side by side with the true physics. |
| Recording | Record runs, replay with a timeline, export CSV/JSON (stored in IndexedDB). |
| MATLAB export | Self-contained `.m` with plant model, generated controller (from the blocks), simulation loop and plots. No toolboxes needed. |
| Persistence | Progress, parameters and diagrams are saved in the browser; export/import as JSON from the main menu. |

## Project layout

```
src/core/          framework-free, unit-tested logic
  systems/         cart-pole, Furuta, Panda (mDH + RNEA + contacts)
  sim/             simulator (RK4/semi-implicit, drag, delay, ghost) and runtime (controller loop, scopes, recording)
  blocks/          block library, compiler (flatten, topo-sort), examples
  matlab/          MATLAB-subset interpreter
  latex/           LaTeX parser + equation checker
  tutorials/       tutorial content (EN/NL) and reference answers
  export/          MATLAB code generation
src/ui/            React UI (three.js viewport, React Flow editor, scopes, tutorial, params, recordings)
tests/             vitest suites
```

## Notes

- Franka inertial parameters are approximate (MuJoCo Menagerie / Gaz et al. 2019) plus a 0.73 kg hand and 0.1 kg·m² armature per joint.
- The MATLAB export does not include environment contacts for the arm.

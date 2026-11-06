import type { I18n, SystemId } from '../types';
import { defaultBlockParams } from './library';
import type { Diagram, Model } from './types';

type N = [id: string, type: string, x: number, y: number, params?: Record<string, any>, name?: string];
type E = [src: string, sp: number, tgt: string, tp: number];

export function mk(nodes: N[], edges: E[]): Diagram {
  return {
    nodes: nodes.map(([id, type, x, y, params, name]) => ({ id, type, x, y, name, params: { ...defaultBlockParams(type), ...(params ?? {}) } })),
    edges: edges.map(([source, sourcePort, target, targetPort], i) => ({ id: `e${i}`, source, sourcePort, target, targetPort })),
  };
}

export interface Example {
  id: string;
  system: SystemId;
  name: I18n;
  desc: I18n;
  model: Model;
}

const L = (en: string, nl: string): I18n => ({ en, nl });

const CARTPOLE_SWINGUP = `function F = fcn(x)
% Energy-based swing-up + LQR catch.  x = [x; theta; xdot; thetadot], theta = 0 upright
% Tip: set the initial pole angle to 3.14 (hanging) in the Parameters panel.
persistent K mode
if isempty(K)
  K = lqr(A_lin, B_lin, diag([10 100 1 1]), 0.1);
  mode = 0;
end
th = wrapToPi(x(2));
if abs(th) < 0.3
  mode = 1;            % close to upright: switch to LQR
elseif abs(th) > 0.8
  mode = 0;            % lost it: swing up again
end
if mode == 1
  F = -K * [x(1); th; x(3); x(4)];
else
  E  = 0.5*m_p*l^2*x(4)^2 + m_p*g*l*cos(x(2));   % pendulum energy
  Eu = m_p*g*l;                                   % energy in the upright position
  a  = 6*(E - Eu)/Eu * x(4)*cos(x(2)) - 3*x(1) - 2.5*x(3);
  if abs(x(4)) < 1e-3 && abs(cos(x(2)) + 1) < 1e-3
    a = 2;             % kick when hanging perfectly still
  end
  a = sat(a, -12, 12);
  % collocated partial feedback linearisation: choose F such that xddot = a
  thdd = (g*sin(x(2)) - a*cos(x(2)))/l;
  F = (m_c + m_p)*a + m_p*l*(thdd*cos(x(2)) - x(4)^2*sin(x(2))) + b_c*x(3);
end
`;

const FURUTA_SWINGUP = `function tau = fcn(x)
% Energy-based swing-up + LQR catch for the Furuta pendulum.
% x = [theta1; theta2; theta1dot; theta2dot], theta2 = 0 upright
% Tip: set the initial pendulum angle to 3.14 (hanging) in the Parameters panel.
persistent K mode
if isempty(K)
  K = lqr(A_lin, B_lin, diag([1 20 0.1 0.5]), 10);
  mode = 0;
end
th2 = wrapToPi(x(2));
if abs(th2) < 0.3
  mode = 1;
elseif abs(th2) > 0.8
  mode = 0;
end
if mode == 1
  tau = -K * [x(1); th2; x(3); x(4)];
else
  E  = 0.5*J_2*x(4)^2 + m_2*g*l_2*cos(x(2));
  Eu = m_2*g*l_2;
  a  = 40*(E - Eu)/Eu * x(4)*cos(x(2)) - 2*x(1) - 1*x(3);   % desired arm acceleration
  if abs(x(4)) < 1e-3 && abs(cos(x(2)) + 1) < 1e-3
    a = 5;
  end
  a = sat(a, -60, 60);
  s = sin(x(2)); c = cos(x(2));
  K2 = m_2*L_1*l_2;
  th2dd = (-K2*c*a + J_2*s*c*x(3)^2 + m_2*g*l_2*s)/J_2;
  tau = (J_0 + J_2*s^2)*a + K2*c*th2dd + 2*J_2*s*c*x(3)*x(4) - K2*s*x(4)^2 + b_1*x(3);
end
`;

const PANDA_CT = `function tau = fcn(q, dq, M, Cqd, g_q)
% Computed-torque control tracking a joint-space sine trajectory.
% tau = M(q) (qdd_d + Kd e_dot + Kp e) + C(q,qdot) qdot + g(q)
w   = 2*pi*0.25;                         % 0.25 Hz
A   = [0.6; 0.3; 0.4; 0.4; 0.5; 0.4; 0.8];
q_d   = q_home + A*sin(w*t);
dq_d  = A*w*cos(w*t);
ddq_d = -A*w^2*sin(w*t);
Kp = 100*eye(7);  Kd = 20*eye(7);       % critically damped error dynamics (wn = 10 rad/s)
e  = q_d - q;
de = dq_d - dq;
tau = M*(ddq_d + Kd*de + Kp*e) + Cqd + g_q;
`;

const PANDA_IMP = `function tau = fcn(p_d, q, dq, J, p, R, g_q)
% Cartesian impedance control: drag the green target in the 3D view.
% F = K (p_d - p) - D v,  orientation held at the initial TCP orientation,
% tau = J' [F; M] + g(q) + null-space posture torque
persistent R_d
if isempty(R_d)
  R_d = R;
end
Kt = 600;  Dt = 2*sqrt(Kt*3);           % translational stiffness [N/m] and damping
Ko = 40;   Do = 2*sqrt(Ko*0.1);         % rotational stiffness [Nm/rad] and damping
v  = J*dq;                               % [linear; angular] TCP velocity
e_o = 0.5*(cross(R(:,1), R_d(:,1)) + cross(R(:,2), R_d(:,2)) + cross(R(:,3), R_d(:,3)));
F  = Kt*(p_d - p) - Dt*v(1:3);
Mo = Ko*e_o - Do*v(4:6);
tau_task = J'*[F; Mo];
N  = eye(7) - J'*pinv(J');              % null-space projector
tau_null = N*(10*(q_home - q) - 2*dq);
tau = tau_task + tau_null + g_q;
`;

const PANDA_INIT = `% Model workspace (runs before the diagram is compiled)
q_home = [0; -pi/4; 0; -3*pi/4; 0; pi/2; pi/4];
Kp = diag([600 600 600 600 250 150 50]);
Kd = diag([50 50 50 50 30 25 15]);
`;

export const EXAMPLES: Example[] = [
  // ---------------------------------------------------------------- cart-pole
  {
    id: 'cp-lqr',
    system: 'cartpole',
    name: L('LQR balance (LQR block)', 'LQR-balanceren (LQR-blok)'),
    desc: L('Full-state LQR around the upright equilibrium using the linearised plant A_lin, B_lin.', 'LQR met volledige toestand rond het rechtopstaande evenwicht met de gelineariseerde plant A_lin, B_lin.'),
    model: {
      Ts: 0.001,
      initScript: '% Model workspace: variables here can be used in block parameters\nQ = diag([10 100 1 1]);   % state weights [x theta xdot thetadot]\nR = 0.1;                  % input weight\n',
      diagram: mk(
        [
          ['state', 'state', 40, 120],
          ['ref', 'constant', 40, 260, { value: '[0; 0; 0; 0]' }, 'x_ref'],
          ['lqr', 'lqr', 300, 160, { Q: 'Q', R: 'R' }],
          ['act', 'actuator', 520, 170],
          ['scope', 'scope', 520, 40, { n: '2' }, 'States & force'],
        ],
        [
          ['state', 2, 'lqr', 0],
          ['ref', 0, 'lqr', 1],
          ['lqr', 0, 'act', 0],
          ['state', 0, 'scope', 0],
          ['lqr', 0, 'scope', 1],
        ],
      ),
    },
  },
  {
    id: 'cp-gain',
    system: 'cartpole',
    name: L('LQR from blocks + position slider', 'LQR met blokken + positieschuif'),
    desc: L('K is computed in the init script with lqr(); the slider moves the cart setpoint.', 'K wordt in het init-script berekend met lqr(); de schuif verplaatst het setpoint van de kar.'),
    model: {
      Ts: 0.001,
      initScript: 'K = lqr(A_lin, B_lin, diag([10 100 1 1]), 0.1);\n',
      diagram: mk(
        [
          ['state', 'state', 40, 60],
          ['slider', 'slider', 40, 200, { min: '-0.8', max: '0.8', value: '0' }, 'Cart setpoint'],
          ['zero', 'constant', 40, 300, { value: '0' }],
          ['mux', 'mux', 240, 200, { n: '4' }],
          ['sum', 'sum', 380, 90, { signs: '+-' }],
          ['K', 'gain', 500, 90, { K: '-K' }],
          ['act', 'actuator', 680, 90],
          ['scope', 'scope', 680, 200, { n: '2' }, 'Position'],
          ['sel', 'selector', 500, 200, { idx: '1' }],
        ],
        [
          ['state', 2, 'sum', 0],
          ['slider', 0, 'mux', 0],
          ['zero', 0, 'mux', 1],
          ['zero', 0, 'mux', 2],
          ['zero', 0, 'mux', 3],
          ['mux', 0, 'sum', 1],
          ['sum', 0, 'K', 0],
          ['K', 0, 'act', 0],
          ['state', 0, 'sel', 0],
          ['sel', 0, 'scope', 0],
          ['slider', 0, 'scope', 1],
        ],
      ),
    },
  },
  {
    id: 'cp-pid',
    system: 'cartpole',
    name: L('PID on the pole angle only', 'PID alleen op de slingerhoek'),
    desc: L('Balances the pole but ignores the cart position: watch it drift into the end-stops. Why does a SISO loop not suffice?', 'Balanceert de slinger maar negeert de karpositie: zie hem tegen de eindstops lopen. Waarom volstaat één SISO-lus niet?'),
    model: {
      Ts: 0.001,
      initScript: '',
      diagram: mk(
        [
          ['state', 'state', 40, 100],
          ['dm', 'demux', 200, 60, { n: '2' }],
          ['pid', 'pid', 360, 60, { Kp: '60', Ki: '20', Kd: '6', N: '200' }],
          ['act', 'actuator', 560, 60],
          ['scope', 'scope', 560, 180, { n: '2' }, 'Angle & position'],
        ],
        [
          ['state', 0, 'dm', 0],
          ['dm', 1, 'pid', 0],
          ['pid', 0, 'act', 0],
          ['dm', 1, 'scope', 0],
          ['dm', 0, 'scope', 1],
        ],
      ),
    },
  },
  {
    id: 'cp-swingup',
    system: 'cartpole',
    name: L('Energy swing-up + LQR (MATLAB Function)', 'Energie-opzwaaien + LQR (MATLAB-functie)'),
    desc: L('Set the initial angle to 3.14 first. Energy shaping pumps the pendulum up; LQR catches it.', 'Zet eerst de beginhoek op 3.14. Energievorming zwaait de slinger op; LQR vangt hem.'),
    model: {
      Ts: 0.001,
      initScript: '',
      diagram: mk(
        [
          ['state', 'state', 40, 100],
          ['fcn', 'matlabfn', 260, 120, { code: CARTPOLE_SWINGUP }, 'Swing-up controller'],
          ['act', 'actuator', 520, 120],
          ['scope', 'scope', 520, 240, { n: '2' }, 'State & force'],
        ],
        [
          ['state', 2, 'fcn', 0],
          ['fcn', 0, 'act', 0],
          ['state', 0, 'scope', 0],
          ['fcn', 0, 'scope', 1],
        ],
      ),
    },
  },
  // ---------------------------------------------------------------- furuta
  {
    id: 'fu-lqr',
    system: 'furuta',
    name: L('LQR balance (LQR block)', 'LQR-balanceren (LQR-blok)'),
    desc: L('Full-state LQR around the upright pendulum.', 'LQR met volledige toestand rond de rechtopstaande slinger.'),
    model: {
      Ts: 0.001,
      initScript: 'Q = diag([1 20 0.1 0.5]);   % [theta1 theta2 theta1dot theta2dot]\nR = 10;\n',
      diagram: mk(
        [
          ['state', 'state', 40, 120],
          ['ref', 'constant', 40, 260, { value: '[0; 0; 0; 0]' }, 'x_ref'],
          ['lqr', 'lqr', 300, 160, { Q: 'Q', R: 'R' }],
          ['act', 'actuator', 520, 170],
          ['scope', 'scope', 520, 40, { n: '2' }, 'Angles & torque'],
        ],
        [
          ['state', 2, 'lqr', 0],
          ['ref', 0, 'lqr', 1],
          ['lqr', 0, 'act', 0],
          ['state', 0, 'scope', 0],
          ['lqr', 0, 'scope', 1],
        ],
      ),
    },
  },
  {
    id: 'fu-swingup',
    system: 'furuta',
    name: L('Energy swing-up + LQR (MATLAB Function)', 'Energie-opzwaaien + LQR (MATLAB-functie)'),
    desc: L('Set the initial pendulum angle to 3.14 first.', 'Zet eerst de beginhoek van de slinger op 3.14.'),
    model: {
      Ts: 0.001,
      initScript: '',
      diagram: mk(
        [
          ['state', 'state', 40, 100],
          ['fcn', 'matlabfn', 260, 120, { code: FURUTA_SWINGUP }, 'Swing-up controller'],
          ['act', 'actuator', 520, 120],
          ['scope', 'scope', 520, 240, { n: '2' }, 'State & torque'],
        ],
        [
          ['state', 2, 'fcn', 0],
          ['fcn', 0, 'act', 0],
          ['state', 0, 'scope', 0],
          ['fcn', 0, 'scope', 1],
        ],
      ),
    },
  },
  // ---------------------------------------------------------------- panda
  {
    id: 'pa-pd',
    system: 'panda',
    name: L('Gravity compensation + joint PD', 'Zwaartekrachtcompensatie + gewrichts-PD'),
    desc: L('τ = Kp (q_d − q) − Kd q̇ + g(q). The slider rotates joint 1.', 'τ = Kp (q_d − q) − Kd q̇ + g(q). De schuif draait gewricht 1.'),
    model: {
      Ts: 0.001,
      initScript: PANDA_INIT,
      diagram: mk(
        [
          ['state', 'state', 40, 140],
          ['home', 'constant', 40, 20, { value: 'q_home' }, 'q_home'],
          ['slider', 'slider', 40, 300, { min: '-1.5', max: '1.5', value: '0' }, 'Joint 1 offset'],
          ['zero', 'constant', 40, 400, { value: '0' }],
          ['mux', 'mux', 220, 330, { n: '7' }],
          ['sumq', 'sum', 380, 40, { signs: '++-' }],
          ['Kp', 'gain', 520, 40, { K: 'Kp' }],
          ['Kd', 'gain', 520, 160, { K: 'Kd' }],
          ['grav', 'gravity', 380, 260],
          ['sumt', 'sum', 700, 140, { signs: '+-+' }],
          ['act', 'actuator', 860, 140],
          ['scope', 'scope', 860, 270, { n: '1' }, 'Joint angles'],
        ],
        [
          ['home', 0, 'sumq', 0],
          ['slider', 0, 'mux', 0],
          ...([1, 2, 3, 4, 5, 6].map((i) => ['zero', 0, 'mux', i]) as E[]),
          ['mux', 0, 'sumq', 1],
          ['state', 0, 'sumq', 2],
          ['sumq', 0, 'Kp', 0],
          ['state', 1, 'Kd', 0],
          ['state', 0, 'grav', 0],
          ['Kp', 0, 'sumt', 0],
          ['Kd', 0, 'sumt', 1],
          ['grav', 0, 'sumt', 2],
          ['sumt', 0, 'act', 0],
          ['state', 0, 'scope', 0],
        ],
      ),
    },
  },
  {
    id: 'pa-ct',
    system: 'panda',
    name: L('Computed-torque trajectory tracking', 'Computed-torque baanvolging'),
    desc: L('Feedback linearisation with M(q), C(q,q̇)q̇ and g(q) blocks feeding a MATLAB Function.', 'Feedbacklinearisatie met M(q)-, C(q,q̇)q̇- en g(q)-blokken naar een MATLAB-functie.'),
    model: {
      Ts: 0.001,
      initScript: PANDA_INIT,
      diagram: mk(
        [
          ['state', 'state', 40, 140],
          ['M', 'massmatrix', 260, 20],
          ['C', 'coriolis', 260, 140],
          ['G', 'gravity', 260, 260],
          ['fcn', 'matlabfn', 480, 120, { code: PANDA_CT }, 'Computed torque'],
          ['act', 'actuator', 720, 140],
          ['scope', 'scope', 720, 260, { n: '1' }, 'Joint angles'],
        ],
        [
          ['state', 0, 'M', 0],
          ['state', 0, 'C', 0],
          ['state', 1, 'C', 1],
          ['state', 0, 'G', 0],
          ['state', 0, 'fcn', 0],
          ['state', 1, 'fcn', 1],
          ['M', 0, 'fcn', 2],
          ['C', 0, 'fcn', 3],
          ['G', 0, 'fcn', 4],
          ['fcn', 0, 'act', 0],
          ['state', 0, 'scope', 0],
        ],
      ),
    },
  },
  {
    id: 'pa-imp',
    system: 'panda',
    name: L('Cartesian impedance (drag the target)', 'Cartesische impedantie (versleep het doel)'),
    desc: L('Spring-damper between TCP and the 3D target. Push the target into the block to feel contact.', 'Veer-demper tussen TCP en het 3D-doel. Duw het doel in het blok om contact te voelen.'),
    model: {
      Ts: 0.001,
      initScript: PANDA_INIT,
      diagram: mk(
        [
          ['target', 'target', 40, 20],
          ['state', 'state', 40, 160],
          ['J', 'jacobian', 260, 20],
          ['fk', 'fk', 260, 130],
          ['G', 'gravity', 260, 260],
          ['fcn', 'matlabfn', 500, 120, { code: PANDA_IMP }, 'Impedance controller'],
          ['act', 'actuator', 740, 140],
          ['scope', 'scope', 740, 260, { n: '2' }, 'TCP vs target'],
        ],
        [
          ['target', 0, 'fcn', 0],
          ['state', 0, 'fcn', 1],
          ['state', 1, 'fcn', 2],
          ['state', 0, 'J', 0],
          ['J', 0, 'fcn', 3],
          ['state', 0, 'fk', 0],
          ['fk', 0, 'fcn', 4],
          ['fk', 1, 'fcn', 5],
          ['state', 0, 'G', 0],
          ['G', 0, 'fcn', 6],
          ['fcn', 0, 'act', 0],
          ['fk', 0, 'scope', 0],
          ['target', 0, 'scope', 1],
        ],
      ),
    },
  },
];

export function examplesFor(sys: SystemId) {
  return EXAMPLES.filter((e) => e.system === sys);
}

export function defaultModel(sys: SystemId): Model {
  const ex = examplesFor(sys)[0];
  return JSON.parse(JSON.stringify(ex.model));
}

import type { FieldDef, SymDef } from '../latex/checker';
import { tx, type Tutorial } from './types';

const R = String.raw;

const Q: SymDef[] = [
  { tex: '\\theta_1', kind: 'angle', desc: tx('arm angle', 'armhoek') },
  { tex: '\\theta_2', kind: 'angle', desc: tx('pendulum angle (0 = upright)', 'slingerhoek (0 = rechtop)') },
  { tex: '\\dot{\\theta}_1', kind: 'rate' },
  { tex: '\\dot{\\theta}_2', kind: 'rate' },
];
const QDD: SymDef[] = [
  { tex: '\\ddot{\\theta}_1', kind: 'accel' },
  { tex: '\\ddot{\\theta}_2', kind: 'accel' },
];
const PAR: SymDef[] = [
  { tex: 'J_0', kind: 'param', desc: tx('arm inertia about the vertical axis incl. m₂L₁²', 'armtraagheid om de verticale as incl. m₂L₁²') },
  { tex: 'J_2', kind: 'param', desc: tx('pendulum inertia about its pivot', 'slingertraagheid om het scharnier') },
  { tex: 'm_2', kind: 'param', desc: tx('pendulum mass', 'slingermassa') },
  { tex: 'L_1', kind: 'param', desc: tx('arm length', 'armlengte') },
  { tex: 'l_2', kind: 'param', desc: tx('pivot → pendulum COM', 'scharnier → zwaartepunt slinger') },
  { tex: 'g', kind: 'param' },
];
const KINPAR: SymDef[] = [
  { tex: 'L_1', kind: 'param' },
  { tex: 'l_2', kind: 'param' },
];
const IN: SymDef[] = [
  { tex: '\\tau', kind: 'input', desc: tx('motor torque on the arm', 'motorkoppel op de arm') },
  { tex: 'b_1', kind: 'param', desc: tx('arm viscous friction', 'viskeuze wrijving arm') },
  { tex: 'b_2', kind: 'param', desc: tx('pendulum viscous friction', 'viskeuze wrijving slinger') },
];
const S_KIN = [...Q, ...PAR];
const S_EOM = [...Q, ...QDD, ...PAR, ...IN];
const f = (d: FieldDef) => d;
const DELTA = R`J_0J_2-m_2^2L_1^2l_2^2`;

export const furutaTutorial: Tutorial = {
  system: 'furuta',
  ghost: {
    fieldSets: [['fu_eom1', 'fu_eom2']],
    map: { theta_1: ['q', 0], theta_2: ['q', 1], dtheta_1: ['dq', 0], dtheta_2: ['dq', 1], ddtheta_1: ['ddq', 0], ddtheta_2: ['ddq', 1], tau: ['u', 0] },
  },
  steps: [
    {
      id: 'intro',
      title: tx('Welcome: the Furuta pendulum', 'Welkom: de Furuta-slinger'),
      body: tx(
        R`The **Furuta** (rotary inverted) pendulum: a motor rotates a horizontal **arm** ($\theta_1$) about the vertical axis; at its tip a **pendulum** ($\theta_2$, $0$ = upright) swings freely in the plane perpendicular to the arm. Unlike the cart-pole, the dynamics are fully **3D and rotational**, which gives gyroscopic coupling terms ($\sin\theta_2\cos\theta_2\,\dot\theta_1^2$).

We follow Cazzolato & Prime (2011) with a slender pendulum. To keep the formulas short we use lumped inertias:
- $J_0 = J_{arm} + m_2 L_1^2$: everything that rotates with $\theta_1$ when the pendulum points along the axis,
- $J_2 = J_{2,cm} + m_2 l_2^2$: pendulum inertia about **its pivot**.

The Parameters panel shows how $J_0$, $J_2$ and $l_2$ follow from masses and lengths.`,
        R`De **Furuta**-slinger (roterende omgekeerde slinger): een motor draait een horizontale **arm** ($\theta_1$) om de verticale as; aan het uiteinde zwaait een **slinger** ($\theta_2$, $0$ = rechtop) vrij in het vlak loodrecht op de arm. Anders dan bij de kar-slinger is de dynamica volledig **3D en roterend**, met gyroscopische koppeltermen ($\sin\theta_2\cos\theta_2\,\dot\theta_1^2$).

We volgen Cazzolato & Prime (2011) met een slanke slinger. Om de formules kort te houden gebruiken we samengestelde traagheden:
- $J_0 = J_{arm} + m_2 L_1^2$: alles wat met $\theta_1$ meedraait als de slinger langs de as wijst,
- $J_2 = J_{2,cm} + m_2 l_2^2$: slingertraagheid om **zijn scharnier**.

Het Parameters-paneel toont hoe $J_0$, $J_2$ en $l_2$ volgen uit massa's en lengtes.`,
      ),
    },
    {
      id: 'kin',
      title: tx('1 · Kinematics of the pendulum', '1 · Kinematica van de slinger'),
      body: tx(
        R`Let $\hat r = [\cos\theta_1, \sin\theta_1, 0]^T$ point along the arm, $\hat t = [-\sin\theta_1, \cos\theta_1, 0]^T$ tangential, $\hat z$ up. The pendulum COM is at
$$p_c = L_1\hat r + l_2(\sin\theta_2\,\hat t + \cos\theta_2\,\hat z)$$
Use $\dot{\hat r} = \dot\theta_1\hat t$ and $\dot{\hat t} = -\dot\theta_1\hat r$ to compute $\lvert\dot p_c\rvert^2$.`,
        R`Laat $\hat r = [\cos\theta_1, \sin\theta_1, 0]^T$ langs de arm wijzen, $\hat t = [-\sin\theta_1, \cos\theta_1, 0]^T$ tangentieel, $\hat z$ omhoog. Het zwaartepunt van de slinger ligt op
$$p_c = L_1\hat r + l_2(\sin\theta_2\,\hat t + \cos\theta_2\,\hat z)$$
Gebruik $\dot{\hat r} = \dot\theta_1\hat t$ en $\dot{\hat t} = -\dot\theta_1\hat r$ om $\lvert\dot p_c\rvert^2$ te berekenen.`,
      ),
      fields: [
        f({
          id: 'fu_v2',
          label: tx('Squared speed of the pendulum COM', 'Kwadraat van de snelheid van het zwaartepunt'),
          prefix: R`\lvert\dot p_c\rvert^2 =`,
          kind: 'expr',
          ref: R`(L_1^2 + l_2^2\sin^2\theta_2)\dot{\theta}_1^2 + 2L_1l_2\cos\theta_2\dot{\theta}_1\dot{\theta}_2 + l_2^2\dot{\theta}_2^2`,
          symbols: [...Q, ...KINPAR],
          hint: tx(R`$\dot p_c = -l_2\sin\theta_2\dot\theta_1\hat r + (L_1\dot\theta_1 + l_2\cos\theta_2\dot\theta_2)\hat t - l_2\sin\theta_2\dot\theta_2\hat z$`, R`$\dot p_c = -l_2\sin\theta_2\dot\theta_1\hat r + (L_1\dot\theta_1 + l_2\cos\theta_2\dot\theta_2)\hat t - l_2\sin\theta_2\dot\theta_2\hat z$`),
        }),
      ],
    },
    {
      id: 'energy',
      title: tx('2 · Energies', '2 · Energieën'),
      body: tx(
        R`Kinetic energy = arm rotation + pendulum translation + pendulum rotation about its COM. For a slender rod the angular velocity component **along** the rod does not contribute, so the rotational part is $\tfrac12 J_{2,cm}(\dot\theta_1^2\sin^2\theta_2 + \dot\theta_2^2)$. Collect terms using $J_0$ and $J_2$.`,
        R`Kinetische energie = rotatie van de arm + translatie van de slinger + rotatie van de slinger om zijn zwaartepunt. Voor een slanke staaf draagt de hoeksnelheid **langs** de staaf niet bij, dus het rotatiedeel is $\tfrac12 J_{2,cm}(\dot\theta_1^2\sin^2\theta_2 + \dot\theta_2^2)$. Verzamel termen met $J_0$ en $J_2$.`,
      ),
      fields: [
        f({ id: 'fu_T', label: tx('Kinetic energy', 'Kinetische energie'), prefix: 'T =', kind: 'expr', ref: R`\frac{1}{2}(J_0+J_2\sin^2\theta_2)\dot{\theta}_1^2 + m_2L_1l_2\cos\theta_2\dot{\theta}_1\dot{\theta}_2 + \frac{1}{2}J_2\dot{\theta}_2^2`, symbols: S_KIN, hint: tx('½J_arm θ̇₁² + ½m₂|ṗ_c|² + ½J₂,cm(θ̇₁² sin²θ₂ + θ̇₂²)', '½J_arm θ̇₁² + ½m₂|ṗ_c|² + ½J₂,cm(θ̇₁² sin²θ₂ + θ̇₂²)') }),
        f({ id: 'fu_V', label: tx('Potential energy', 'Potentiële energie'), prefix: 'V =', kind: 'expr', ref: R`m_2 g l_2\cos\theta_2`, symbols: S_KIN, offset: true, hint: tx('Height of the pendulum COM.', 'Hoogte van het zwaartepunt van de slinger.') }),
      ],
    },
    {
      id: 'eom',
      title: tx('3 · Equations of motion (with viscous friction)', '3 · Bewegingsvergelijkingen (met viskeuze wrijving)'),
      body: tx(
        R`Apply Euler–Lagrange with generalized forces $Q = [\tau - b_1\dot\theta_1,\ -b_2\dot\theta_2]^T$. Watch for the term $\frac{d}{dt}(J_2\sin^2\theta_2)\,\dot\theta_1 = 2J_2\sin\theta_2\cos\theta_2\,\dot\theta_2\dot\theta_1$.

When both are correct, the 👻 ghost uses your equations.`,
        R`Pas Euler–Lagrange toe met gegeneraliseerde krachten $Q = [\tau - b_1\dot\theta_1,\ -b_2\dot\theta_2]^T$. Let op de term $\frac{d}{dt}(J_2\sin^2\theta_2)\,\dot\theta_1 = 2J_2\sin\theta_2\cos\theta_2\,\dot\theta_2\dot\theta_1$.

Als beide kloppen gebruikt de 👻 geest jouw vergelijkingen.`,
      ),
      fields: [
        f({ id: 'fu_eom1', label: tx('Equation for θ₁ (arm)', 'Vergelijking voor θ₁ (arm)'), kind: 'equation', ref: R`(J_0+J_2\sin^2\theta_2)\ddot{\theta}_1 + m_2L_1l_2\cos\theta_2\ddot{\theta}_2 + 2J_2\sin\theta_2\cos\theta_2\dot{\theta}_1\dot{\theta}_2 - m_2L_1l_2\sin\theta_2\dot{\theta}_2^2 = \tau - b_1\dot{\theta}_1`, symbols: S_EOM, hint: tx('∂L/∂θ₁ = 0: θ₁ is a cyclic coordinate.', '∂L/∂θ₁ = 0: θ₁ is een cyclische coördinaat.') }),
        f({ id: 'fu_eom2', label: tx('Equation for θ₂ (pendulum)', 'Vergelijking voor θ₂ (slinger)'), kind: 'equation', ref: R`m_2L_1l_2\cos\theta_2\ddot{\theta}_1 + J_2\ddot{\theta}_2 - J_2\sin\theta_2\cos\theta_2\dot{\theta}_1^2 - m_2gl_2\sin\theta_2 = -b_2\dot{\theta}_2`, symbols: S_EOM, hint: tx('The θ̇₁θ̇₂ terms cancel; a centrifugal θ̇₁² term remains.', 'De θ̇₁θ̇₂-termen vallen weg; een centrifugale θ̇₁²-term blijft.') }),
      ],
      actions: [{ type: 'enableGhost', label: tx('Show ghost (your equations)', 'Toon geest (jouw vergelijkingen)') }],
    },
    {
      id: 'matrix',
      title: tx('4 · Robot form', '4 · Robotvorm'),
      body: tx(R`Write $M(q)\ddot q + C(q,\dot q)\dot q + g(q) = [\tau,\ 0]^T - \tau_f$ with the Christoffel choice of $C$.`, R`Schrijf $M(q)\ddot q + C(q,\dot q)\dot q + g(q) = [\tau,\ 0]^T - \tau_f$ met de Christoffel-keuze voor $C$.`),
      fields: [
        f({ id: 'fu_M', label: tx('Mass matrix', 'Massamatrix'), prefix: 'M(q) =', kind: 'expr', ref: R`\begin{bmatrix}J_0+J_2\sin^2\theta_2 & m_2L_1l_2\cos\theta_2\\ m_2L_1l_2\cos\theta_2 & J_2\end{bmatrix}`, symbols: S_KIN, hint: tx('Read it off from T.', 'Lees hem af uit T.') }),
        f({ id: 'fu_C', label: tx('Coriolis matrix', 'Coriolismatrix'), prefix: R`C(q,\dot q) =`, kind: 'expr', ref: R`\begin{bmatrix}J_2\sin\theta_2\cos\theta_2\dot{\theta}_2 & J_2\sin\theta_2\cos\theta_2\dot{\theta}_1 - m_2L_1l_2\sin\theta_2\dot{\theta}_2\\ -J_2\sin\theta_2\cos\theta_2\dot{\theta}_1 & 0\end{bmatrix}`, symbols: S_KIN, christoffel: ['\\dot{\\theta}_1', '\\dot{\\theta}_2'], hint: tx('M₁₁ and M₁₂ depend on θ₂.', 'M₁₁ en M₁₂ hangen af van θ₂.') }),
        f({ id: 'fu_g', label: tx('Gravity vector', 'Zwaartekrachtvector'), prefix: 'g(q) =', kind: 'expr', ref: R`\begin{bmatrix}0\\-m_2gl_2\sin\theta_2\end{bmatrix}`, symbols: S_KIN, hint: tx('g = ∂V/∂q', 'g = ∂V/∂q') }),
      ],
    },
    {
      id: 'lin',
      title: tx('5 · Linearization & LQR', '5 · Linearisatie & LQR'),
      body: tx(
        R`State $\mathbf x = [\theta_1, \theta_2, \dot\theta_1, \dot\theta_2]^T$, input $\tau$, equilibrium upright. Ignore friction. Write $\Delta = \det M(0) = J_0J_2 - (m_2L_1l_2)^2$ in the denominators.

Then load the LQR example. Note how the arm must first move *away* to bring the pendulum back: the system is **non-minimum phase** from $\tau$ to $\theta_1$.`,
        R`Toestand $\mathbf x = [\theta_1, \theta_2, \dot\theta_1, \dot\theta_2]^T$, ingang $\tau$, evenwicht rechtop. Negeer wrijving. Schrijf $\Delta = \det M(0) = J_0J_2 - (m_2L_1l_2)^2$ in de noemers.

Laad daarna het LQR-voorbeeld. Zie hoe de arm eerst de *andere kant* op moet om de slinger terug te brengen: het systeem is **niet-minimumfase** van $\tau$ naar $\theta_1$.`,
      ),
      fields: [
        f({ id: 'fu_A', label: tx('System matrix A', 'Systeemmatrix A'), prefix: 'A =', kind: 'expr', ref: `\\begin{bmatrix}0&0&1&0\\\\0&0&0&1\\\\0&\\frac{-m_2^2L_1l_2^2g}{${DELTA}}&0&0\\\\0&\\frac{J_0m_2gl_2}{${DELTA}}&0&0\\end{bmatrix}`, symbols: PAR, hint: tx(R`$M(0)^{-1} = \frac{1}{\Delta}\begin{bmatrix}J_2 & -m_2L_1l_2\\ -m_2L_1l_2 & J_0\end{bmatrix}$`, R`$M(0)^{-1} = \frac{1}{\Delta}\begin{bmatrix}J_2 & -m_2L_1l_2\\ -m_2L_1l_2 & J_0\end{bmatrix}$`) }),
        f({ id: 'fu_B', label: tx('Input matrix B', 'Ingangsmatrix B'), prefix: 'B =', kind: 'expr', ref: `\\begin{bmatrix}0\\\\0\\\\\\frac{J_2}{${DELTA}}\\\\\\frac{-m_2L_1l_2}{${DELTA}}\\end{bmatrix}`, symbols: PAR, hint: tx('B = [0; 0; M(0)⁻¹ [1; 0]]', 'B = [0; 0; M(0)⁻¹ [1; 0]]') }),
      ],
      actions: [
        { type: 'setParams', params: { theta2_0: 0.1 }, label: tx('Initial pendulum angle 0.1 rad', 'Beginhoek slinger 0.1 rad') },
        { type: 'loadExample', exampleId: 'fu-lqr', label: tx('Load solution: LQR', 'Oplossing laden: LQR') },
      ],
    },
    {
      id: 'swing',
      title: tx('6 · Swing-up', '6 · Opzwaaien'),
      body: tx(
        R`Same idea as the cart-pole: with arm acceleration $a = \ddot\theta_1$ as virtual input, the pendulum energy $E = \tfrac12 J_2\dot\theta_2^2 + m_2 g l_2\cos\theta_2$ obeys (ignoring the small centrifugal term)
$$\dot E \approx -m_2L_1l_2\,a\,\dot\theta_2\cos\theta_2$$
so $a = k(E - E_{up})\dot\theta_2\cos\theta_2$ pumps energy in. The torque follows from partial feedback linearization of the $\theta_1$-equation. Set the initial pendulum angle to 3.14 and load the example.`,
        R`Zelfde idee als bij de kar-slinger: met armversnelling $a = \ddot\theta_1$ als virtuele ingang voldoet de slingerenergie $E = \tfrac12 J_2\dot\theta_2^2 + m_2 g l_2\cos\theta_2$ aan (de kleine centrifugale term verwaarlozend)
$$\dot E \approx -m_2L_1l_2\,a\,\dot\theta_2\cos\theta_2$$
dus $a = k(E - E_{up})\dot\theta_2\cos\theta_2$ pompt energie erin. Het koppel volgt uit partiële feedbacklinearisatie van de $\theta_1$-vergelijking. Zet de beginhoek op 3.14 en laad het voorbeeld.`,
      ),
      fields: [f({ id: 'fu_E', label: tx('Pendulum energy', 'Slingerenergie'), prefix: 'E =', kind: 'expr', ref: R`\frac{1}{2}J_2\dot{\theta}_2^2 + m_2gl_2\cos\theta_2`, symbols: S_KIN, offset: true, hint: tx('Kinetic energy about the pivot + potential energy.', 'Kinetische energie om het scharnier + potentiële energie.') })],
      actions: [
        { type: 'setParams', params: { theta2_0: 3.14 }, label: tx('Set initial angle to 3.14', 'Zet beginhoek op 3.14') },
        { type: 'loadExample', exampleId: 'fu-swingup', label: tx('Load solution: swing-up + LQR', 'Oplossing laden: opzwaaien + LQR') },
      ],
    },
  ],
};

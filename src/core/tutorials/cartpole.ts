import type { FieldDef, SymDef } from '../latex/checker';
import { tx, type Tutorial } from './types';

const R = String.raw;

const Q: SymDef[] = [
  { tex: 'x', kind: 'real', desc: tx('cart position', 'karpositie') },
  { tex: '\\theta', kind: 'angle', desc: tx('pole angle (0 = upright)', 'slingerhoek (0 = rechtop)') },
  { tex: '\\dot{x}', kind: 'rate' },
  { tex: '\\dot{\\theta}', kind: 'rate' },
];
const QDD: SymDef[] = [
  { tex: '\\ddot{x}', kind: 'accel' },
  { tex: '\\ddot{\\theta}', kind: 'accel' },
];
const PAR: SymDef[] = [
  { tex: 'm_c', kind: 'param', desc: tx('cart mass', 'karmassa') },
  { tex: 'm_p', kind: 'param', desc: tx('bob mass', 'slingermassa') },
  { tex: 'l', kind: 'param', desc: tx('pole length', 'slingerlengte') },
  { tex: 'g', kind: 'param', desc: tx('gravity', 'zwaartekracht') },
];
const IN: SymDef[] = [{ tex: 'F', kind: 'input', desc: tx('force on the cart', 'kracht op de kar') }];
const FR: SymDef[] = [
  { tex: 'b_c', kind: 'param', desc: tx('cart viscous friction', 'viskeuze wrijving kar') },
  { tex: 'F_c', kind: 'param', desc: tx('cart Coulomb friction', 'Coulombwrijving kar') },
  { tex: 'b_p', kind: 'param', desc: tx('pivot viscous friction', 'viskeuze wrijving scharnier') },
];
const S_KIN = [...Q, ...PAR];
const S_EOM = [...Q, ...QDD, ...PAR, ...IN];
const S_FR = [...S_EOM, ...FR];

const f = (d: FieldDef) => d;

export const cartpoleTutorial: Tutorial = {
  system: 'cartpole',
  ghost: {
    fieldSets: [
      ['cp_eomf_x', 'cp_eomf_th'],
      ['cp_eom_x', 'cp_eom_th'],
    ],
    map: { x: ['q', 0], theta: ['q', 1], dx: ['dq', 0], dtheta: ['dq', 1], ddx: ['ddq', 0], ddtheta: ['ddq', 1], F: ['u', 0] },
  },
  steps: [
    {
      id: 'intro',
      title: tx('Welcome: the cart-pole', 'Welkom: de kar-slinger'),
      body: tx(
        R`The **cart-pole** is the "hello world" of underactuated robotics: one actuator (a horizontal force $F$ on the cart) and two degrees of freedom. In this tutorial you will:

1. derive the equations of motion with **Lagrange**,
2. add **friction and drag** as non-conservative generalized forces,
3. write them in robot form $M(q)\ddot q + C(q,\dot q)\dot q + g(q) = \tau$,
4. **linearize** (Jacobians!) and design an **LQR** controller,
5. build the controller with **blocks** and watch it run,
6. design an **energy-based swing-up**.

**How to use this app**
- Drag the cart or the pole with the mouse in the 3D view to push it. Use ←/→ for a force on the cart, and the *Kick* button for an impulse.
- Every formula field has a **Check** button. Type LaTeX like in Overleaf (\frac{1}{2}, \dot{\theta}, \sin\theta) or use the visual editor. The checker accepts *any* mathematically equivalent form, because it compares your expression with the reference at many random points.
- Use the symbol palette under each field: the checker only knows those symbols.
- *Guided mode* (top bar) locks the next step until all checks of the current step pass.`,
        R`De **kar-slinger** is de "hello world" van onderactueerde robotica: één actuator (een horizontale kracht $F$ op de kar) en twee vrijheidsgraden. In deze tutorial ga je:

1. de bewegingsvergelijkingen afleiden met **Lagrange**,
2. **wrijving en luchtweerstand** toevoegen als niet-conservatieve gegeneraliseerde krachten,
3. ze schrijven in robotvorm $M(q)\ddot q + C(q,\dot q)\dot q + g(q) = \tau$,
4. **lineariseren** (Jacobianen!) en een **LQR**-regelaar ontwerpen,
5. de regelaar bouwen met **blokken** en hem zien werken,
6. een **energiegebaseerde opzwaai-regelaar** ontwerpen.

**Zo gebruik je de app**
- Sleep de kar of de slinger met de muis in de 3D-weergave om te duwen. ←/→ geeft een kracht op de kar, de *Kick*-knop een impuls.
- Elk formuleveld heeft een **Controleer**-knop. Typ LaTeX zoals in Overleaf (\frac{1}{2}, \dot{\theta}, \sin\theta) of gebruik de visuele editor. De controle accepteert *elke* wiskundig equivalente vorm, omdat je uitdrukking op veel willekeurige punten met de referentie wordt vergeleken.
- Gebruik het symbolenpalet onder elk veld: de controle kent alleen die symbolen.
- *Begeleide modus* (bovenbalk) vergrendelt de volgende stap tot alle controles van de huidige stap slagen.`,
      ),
    },
    {
      id: 'kinematics',
      title: tx('1 · Generalized coordinates & kinematics', '1 · Gegeneraliseerde coördinaten & kinematica'),
      body: tx(
        R`Choose generalized coordinates $q = [x,\ \theta]^T$: the cart position and the pole angle, with $\theta = 0$ **upright** and positive $\theta$ tilting the pole towards $+x$.

The bob (point mass $m_p$ at distance $l$ from the pivot) is at
$$p = \begin{bmatrix} x + l\sin\theta \\ l\cos\theta \end{bmatrix}$$
Differentiate with respect to time (chain rule!) to get $\dot p$, then compute the squared speed $v^2 = \dot p^T \dot p$.`,
        R`Kies gegeneraliseerde coördinaten $q = [x,\ \theta]^T$: de karpositie en de slingerhoek, met $\theta = 0$ **rechtop** en positieve $\theta$ kantelend richting $+x$.

De massa (puntmassa $m_p$ op afstand $l$ van het scharnier) zit op
$$p = \begin{bmatrix} x + l\sin\theta \\ l\cos\theta \end{bmatrix}$$
Differentieer naar de tijd (kettingregel!) voor $\dot p$ en bereken dan het kwadraat van de snelheid $v^2 = \dot p^T \dot p$.`,
      ),
      fields: [
        f({
          id: 'cp_v2',
          label: tx('Squared speed of the bob', 'Kwadraat van de snelheid van de massa'),
          prefix: 'v^2 =',
          kind: 'expr',
          ref: R`\dot{x}^2 + 2l\dot{x}\dot{\theta}\cos\theta + l^2\dot{\theta}^2`,
          symbols: S_KIN,
          hint: tx(R`$\dot p = [\dot x + l\cos\theta\,\dot\theta,\ -l\sin\theta\,\dot\theta]^T$. Use $\sin^2+\cos^2=1$.`, R`$\dot p = [\dot x + l\cos\theta\,\dot\theta,\ -l\sin\theta\,\dot\theta]^T$. Gebruik $\sin^2+\cos^2=1$.`),
        }),
      ],
    },
    {
      id: 'energy',
      title: tx('2 · Kinetic & potential energy', '2 · Kinetische & potentiële energie'),
      body: tx(
        R`The kinetic energy is the sum over all bodies:
$$T = \tfrac12 m_c \dot x^2 + \tfrac12 m_p v^2$$
(the rod is massless, the bob a point mass). The potential energy only comes from the bob's height. Any constant offset in $V$ is irrelevant: only $\partial V/\partial q$ enters the dynamics.`,
        R`De kinetische energie is de som over alle lichamen:
$$T = \tfrac12 m_c \dot x^2 + \tfrac12 m_p v^2$$
(de staaf is massaloos, de massa een puntmassa). De potentiële energie komt alleen van de hoogte van de massa. Een constante verschuiving in $V$ maakt niet uit: alleen $\partial V/\partial q$ komt in de dynamica.`,
      ),
      fields: [
        f({
          id: 'cp_T',
          label: tx('Kinetic energy', 'Kinetische energie'),
          prefix: 'T =',
          kind: 'expr',
          ref: R`\frac{1}{2}(m_c+m_p)\dot{x}^2 + m_p l\dot{x}\dot{\theta}\cos\theta + \frac{1}{2}m_p l^2\dot{\theta}^2`,
          symbols: S_KIN,
          hint: tx(R`Substitute $v^2$ from step 1 into $T = \tfrac12 m_c\dot x^2 + \tfrac12 m_p v^2$.`, R`Vul $v^2$ uit stap 1 in in $T = \tfrac12 m_c\dot x^2 + \tfrac12 m_p v^2$.`),
        }),
        f({
          id: 'cp_V',
          label: tx('Potential energy', 'Potentiële energie'),
          prefix: 'V =',
          kind: 'expr',
          ref: R`m_p g l\cos\theta`,
          symbols: S_KIN,
          offset: true,
          hint: tx(R`$V = m_p g\,h$ with $h$ the height of the bob above the pivot.`, R`$V = m_p g\,h$ met $h$ de hoogte van de massa boven het scharnier.`),
        }),
      ],
    },
    {
      id: 'lagrangian',
      title: tx('3 · The Lagrangian and its derivatives', '3 · De Lagrangiaan en haar afgeleiden'),
      body: tx(
        R`The Lagrangian is $L = T - V$. The **Euler–Lagrange equations** give one equation per generalized coordinate $q_i$:
$$\frac{d}{dt}\left(\frac{\partial L}{\partial \dot q_i}\right) - \frac{\partial L}{\partial q_i} = Q_i$$
where $Q_i$ is the **generalized force** of all non-conservative forces (actuators, friction, drag) acting along $q_i$.

Compute the pieces below. Remember that $\frac{d}{dt}$ is a *total* time derivative: $\frac{d}{dt}\cos\theta = -\sin\theta\,\dot\theta$.`,
        R`De Lagrangiaan is $L = T - V$. De **Euler–Lagrange-vergelijkingen** geven één vergelijking per gegeneraliseerde coördinaat $q_i$:
$$\frac{d}{dt}\left(\frac{\partial L}{\partial \dot q_i}\right) - \frac{\partial L}{\partial q_i} = Q_i$$
waarbij $Q_i$ de **gegeneraliseerde kracht** is van alle niet-conservatieve krachten (actuatoren, wrijving, luchtweerstand) langs $q_i$.

Bereken de onderdelen hieronder. Let op: $\frac{d}{dt}$ is een *totale* tijdsafgeleide: $\frac{d}{dt}\cos\theta = -\sin\theta\,\dot\theta$.`,
      ),
      fields: [
        f({ id: 'cp_L', label: tx('Lagrangian', 'Lagrangiaan'), prefix: 'L =', kind: 'expr', ref: R`\frac{1}{2}(m_c+m_p)\dot{x}^2 + m_p l\dot{x}\dot{\theta}\cos\theta + \frac{1}{2}m_p l^2\dot{\theta}^2 - m_p g l\cos\theta`, symbols: S_KIN, offset: true, hint: tx('L = T − V', 'L = T − V') }),
        f({ id: 'cp_dLdxd', label: tx('∂L/∂ẋ', '∂L/∂ẋ'), prefix: R`\frac{\partial L}{\partial \dot x} =`, kind: 'expr', ref: R`(m_c+m_p)\dot{x} + m_p l\dot{\theta}\cos\theta`, symbols: S_KIN, hint: tx('Treat θ, θ̇ and x as constants.', 'Behandel θ, θ̇ en x als constanten.') }),
        f({ id: 'cp_dLdthd', label: tx('∂L/∂θ̇', '∂L/∂θ̇'), prefix: R`\frac{\partial L}{\partial \dot\theta} =`, kind: 'expr', ref: R`m_p l\dot{x}\cos\theta + m_p l^2\dot{\theta}`, symbols: S_KIN, hint: tx('Two terms of T contain θ̇.', 'Twee termen van T bevatten θ̇.') }),
        f({
          id: 'cp_ddt',
          label: tx('d/dt (∂L/∂θ̇)', 'd/dt (∂L/∂θ̇)'),
          prefix: R`\frac{d}{dt}\frac{\partial L}{\partial \dot\theta} =`,
          kind: 'expr',
          ref: R`m_p l\ddot{x}\cos\theta - m_p l\dot{x}\dot{\theta}\sin\theta + m_p l^2\ddot{\theta}`,
          symbols: [...S_KIN, ...QDD],
          hint: tx(R`Product rule on $m_p l\dot x\cos\theta$.`, R`Productregel op $m_p l\dot x\cos\theta$.`),
        }),
        f({ id: 'cp_dLdth', label: tx('∂L/∂θ', '∂L/∂θ'), prefix: R`\frac{\partial L}{\partial \theta} =`, kind: 'expr', ref: R`-m_p l\dot{x}\dot{\theta}\sin\theta + m_p g l\sin\theta`, symbols: S_KIN, hint: tx('Both T and V depend on θ.', 'Zowel T als V hangen af van θ.') }),
      ],
    },
    {
      id: 'eom',
      title: tx('4 · Equations of motion', '4 · Bewegingsvergelijkingen'),
      body: tx(
        R`Combine the pieces. The actuator force $F$ acts along $x$, so $Q = [F,\ 0]^T$ (no friction yet). Write each equation as *something = something*; the checker accepts any rearrangement or scaling.

When both equations are correct you can enable the **ghost** (👻 in the toolbar): a transparent pendulum simulated with *your* equations, next to the true physics. Set the friction parameters to zero to compare fairly.`,
        R`Combineer de onderdelen. De actuatorkracht $F$ werkt langs $x$, dus $Q = [F,\ 0]^T$ (nog geen wrijving). Schrijf elke vergelijking als *iets = iets*; de controle accepteert elke herschikking of schaling.

Als beide vergelijkingen kloppen kun je de **geest** (👻 in de werkbalk) aanzetten: een transparante slinger gesimuleerd met *jouw* vergelijkingen, naast de echte fysica. Zet de wrijvingsparameters op nul voor een eerlijke vergelijking.`,
      ),
      fields: [
        f({ id: 'cp_eom_x', label: tx('Equation for x', 'Vergelijking voor x'), kind: 'equation', ref: R`(m_c+m_p)\ddot{x} + m_p l\ddot{\theta}\cos\theta - m_p l\dot{\theta}^2\sin\theta = F`, symbols: S_EOM, hint: tx('∂L/∂x = 0, so only d/dt(∂L/∂ẋ) remains.', '∂L/∂x = 0, dus alleen d/dt(∂L/∂ẋ) blijft over.') }),
        f({ id: 'cp_eom_th', label: tx('Equation for θ', 'Vergelijking voor θ'), kind: 'equation', ref: R`m_p l\ddot{x}\cos\theta + m_p l^2\ddot{\theta} - m_p g l\sin\theta = 0`, symbols: S_EOM, hint: tx('d/dt(∂L/∂θ̇) − ∂L/∂θ = 0. The ẋθ̇ terms cancel.', 'd/dt(∂L/∂θ̇) − ∂L/∂θ = 0. De ẋθ̇-termen vallen weg.') }),
      ],
      actions: [{ type: 'setParams', params: { b_c: 0, F_c: 0, F_s: 0, b_p: 0, F_cp: 0, c_air: 0 }, label: tx('Set all friction & drag to zero', 'Zet alle wrijving & luchtweerstand op nul') }, { type: 'enableGhost', label: tx('Show ghost (your equations)', 'Toon geest (jouw vergelijkingen)') }],
    },
    {
      id: 'friction',
      title: tx('5 · Friction, drag & other external forces', '5 · Wrijving, luchtweerstand & andere externe krachten'),
      body: tx(
        R`Non-conservative forces do not come from a potential, so they enter through the right-hand side $Q_i$. The systematic way is **virtual work**: a force $F_k$ acting at point $p_k$ contributes
$$Q_i = \sum_k F_k^T\,\frac{\partial p_k}{\partial q_i} \qquad\Longleftrightarrow\qquad Q = J_k(q)^T F_k$$
— exactly the Jacobian-transpose you know from robotics. Common models (per joint, velocity $v$):

| Model | Force opposing motion |
|---|---|
| Viscous | $b\,v$ |
| Coulomb | $F_c\,\mathrm{sign}(v)$ |
| Stribeck | $\big(F_c + (F_s - F_c)e^{-(v/v_s)^2}\big)\mathrm{sign}(v)$ |
| Air drag (quadratic) | $c_d\,\lvert v\rvert\, v$ on a body point, mapped with $J^T$ |

$\mathrm{sign}(v)$ makes the ODE discontinuous at $v=0$; simulators often use $\tanh(v/\varepsilon)$ instead (see *Coulomb model* in the Parameters panel). Try both and watch the cart **chatter**.

Now add **viscous + Coulomb friction on the cart** ($b_c$, $F_c$) and **viscous friction at the pivot** ($b_p$). Type $\mathrm{sign}$ as \operatorname{sign} or \mathrm{sgn}.

*Air drag* on the bob: $F_d = -c_d\lvert v\rvert v$ with $v = \dot p$. Its generalized force is $Q = J_b^T F_d$ with $J_b = \partial p/\partial q$. (Not checked here, but it is what the simulator does.)`,
        R`Niet-conservatieve krachten komen niet uit een potentiaal, dus ze komen via het rechterlid $Q_i$ binnen. De systematische manier is **virtuele arbeid**: een kracht $F_k$ in punt $p_k$ draagt bij met
$$Q_i = \sum_k F_k^T\,\frac{\partial p_k}{\partial q_i} \qquad\Longleftrightarrow\qquad Q = J_k(q)^T F_k$$
— precies de Jacobiaan-getransponeerde die je kent uit de robotica. Gangbare modellen (per gewricht, snelheid $v$):

| Model | Kracht tegen de beweging in |
|---|---|
| Viskeus | $b\,v$ |
| Coulomb | $F_c\,\mathrm{sign}(v)$ |
| Stribeck | $\big(F_c + (F_s - F_c)e^{-(v/v_s)^2}\big)\mathrm{sign}(v)$ |
| Luchtweerstand (kwadratisch) | $c_d\,\lvert v\rvert\, v$ op een punt, via $J^T$ |

$\mathrm{sign}(v)$ maakt de ODE discontinu bij $v=0$; simulatoren gebruiken vaak $\tanh(v/\varepsilon)$ (zie *Coulomb-model* in het Parameters-paneel). Probeer beide en zie de kar **chatteren**.

Voeg nu **viskeuze + Coulombwrijving op de kar** ($b_c$, $F_c$) en **viskeuze wrijving in het scharnier** ($b_p$) toe. Typ $\mathrm{sign}$ als \operatorname{sign} of \mathrm{sgn}.

*Luchtweerstand* op de massa: $F_d = -c_d\lvert v\rvert v$ met $v = \dot p$. De gegeneraliseerde kracht is $Q = J_b^T F_d$ met $J_b = \partial p/\partial q$. (Niet gecontroleerd, maar zo doet de simulator het.)`,
      ),
      fields: [
        f({ id: 'cp_eomf_x', label: tx('Equation for x, with friction', 'Vergelijking voor x, met wrijving'), kind: 'equation', ref: R`(m_c+m_p)\ddot{x} + m_p l\ddot{\theta}\cos\theta - m_p l\dot{\theta}^2\sin\theta = F - b_c\dot{x} - F_c\operatorname{sign}(\dot{x})`, symbols: S_FR, hint: tx('Friction opposes the cart velocity ẋ.', 'Wrijving werkt tegen de karsnelheid ẋ in.') }),
        f({ id: 'cp_eomf_th', label: tx('Equation for θ, with pivot friction', 'Vergelijking voor θ, met scharnierwrijving'), kind: 'equation', ref: R`m_p l\ddot{x}\cos\theta + m_p l^2\ddot{\theta} - m_p g l\sin\theta = -b_p\dot{\theta}`, symbols: S_FR, hint: tx('The pivot friction torque opposes θ̇.', 'Het wrijvingskoppel in het scharnier werkt tegen θ̇ in.') }),
      ],
      actions: [{ type: 'setParams', params: { b_c: 0.5, F_c: 1, b_p: 0.005, coulomb_model: 'tanh' }, label: tx('Set b_c = 0.5, F_c = 1, b_p = 0.005', 'Zet b_c = 0.5, F_c = 1, b_p = 0.005') }, { type: 'enableGhost', label: tx('Show ghost (your equations)', 'Toon geest (jouw vergelijkingen)') }],
    },
    {
      id: 'matrix',
      title: tx('6 · Robot form: M(q), C(q,q̇), g(q)', '6 · Robotvorm: M(q), C(q,q̇), g(q)'),
      body: tx(
        R`Every rigid-body system can be written as
$$M(q)\ddot q + C(q,\dot q)\dot q + g(q) = \tau - \tau_f, \qquad \tau = \begin{bmatrix}F\\0\end{bmatrix}$$
- $M(q)$: symmetric positive-definite **mass matrix**, read off from $T = \tfrac12\dot q^T M(q)\dot q$.
- $C(q,\dot q)$: Coriolis/centrifugal matrix. It is not unique; the standard choice uses **Christoffel symbols**
$$c_{ij} = \sum_k \tfrac12\left(\frac{\partial M_{ij}}{\partial q_k} + \frac{\partial M_{ik}}{\partial q_j} - \frac{\partial M_{jk}}{\partial q_i}\right)\dot q_k$$
which makes $\dot M - 2C$ skew-symmetric.
- $g(q) = \partial V/\partial q$: gravity vector.

Enter the matrices with the matrix tool of the visual editor, or in raw LaTeX: \begin{bmatrix} a & b \\ c & d \end{bmatrix}.`,
        R`Elk star-lichaamsysteem kan geschreven worden als
$$M(q)\ddot q + C(q,\dot q)\dot q + g(q) = \tau - \tau_f, \qquad \tau = \begin{bmatrix}F\\0\end{bmatrix}$$
- $M(q)$: symmetrische positief-definiete **massamatrix**, af te lezen uit $T = \tfrac12\dot q^T M(q)\dot q$.
- $C(q,\dot q)$: Coriolis/centrifugaalmatrix. Niet uniek; de standaardkeuze gebruikt **Christoffelsymbolen**
$$c_{ij} = \sum_k \tfrac12\left(\frac{\partial M_{ij}}{\partial q_k} + \frac{\partial M_{ik}}{\partial q_j} - \frac{\partial M_{jk}}{\partial q_i}\right)\dot q_k$$
waarmee $\dot M - 2C$ scheef-symmetrisch wordt.
- $g(q) = \partial V/\partial q$: zwaartekrachtvector.

Voer matrices in met de matrixtool van de visuele editor, of in ruwe LaTeX: \begin{bmatrix} a & b \\ c & d \end{bmatrix}.`,
      ),
      fields: [
        f({ id: 'cp_M', label: tx('Mass matrix', 'Massamatrix'), prefix: 'M(q) =', kind: 'expr', ref: R`\begin{bmatrix} m_c+m_p & m_p l\cos\theta \\ m_p l\cos\theta & m_p l^2 \end{bmatrix}`, symbols: S_KIN, hint: tx('Coefficients of ẋ², ẋθ̇ and θ̇² in T (remember the factor ½ and symmetry).', 'Coëfficiënten van ẋ², ẋθ̇ en θ̇² in T (denk aan de factor ½ en symmetrie).') }),
        f({ id: 'cp_C', label: tx('Coriolis matrix', 'Coriolismatrix'), prefix: R`C(q,\dot q) =`, kind: 'expr', ref: R`\begin{bmatrix} 0 & -m_p l\dot{\theta}\sin\theta \\ 0 & 0 \end{bmatrix}`, symbols: S_KIN, christoffel: ['\\dot{x}', '\\dot{\\theta}'], hint: tx('Only M₁₂ depends on q (on θ).', 'Alleen M₁₂ hangt van q af (van θ).') }),
        f({ id: 'cp_g', label: tx('Gravity vector', 'Zwaartekrachtvector'), prefix: 'g(q) =', kind: 'expr', ref: R`\begin{bmatrix} 0 \\ -m_p g l\sin\theta \end{bmatrix}`, symbols: S_KIN, hint: tx('g = ∂V/∂q', 'g = ∂V/∂q') }),
      ],
    },
    {
      id: 'linearize',
      title: tx('7 · Linearization (Jacobians)', '7 · Linearisatie (Jacobianen)'),
      body: tx(
        R`With state $\mathbf{x} = [x,\ \theta,\ \dot x,\ \dot\theta]^T$ the dynamics are $\dot{\mathbf{x}} = f(\mathbf{x}, F)$ with $\ddot q = M(q)^{-1}(\tau - C\dot q - g)$. Around the upright equilibrium $\mathbf{x}^* = 0$, $F^* = 0$:
$$\dot{\tilde{\mathbf x}} \approx A\tilde{\mathbf x} + B\tilde F,\qquad A = \left.\frac{\partial f}{\partial \mathbf x}\right|_{*},\quad B = \left.\frac{\partial f}{\partial F}\right|_{*}$$
Tip: at the equilibrium all terms quadratic in velocities vanish, $\cos\theta \approx 1$, $\sin\theta \approx \theta$. Solve the $2\times 2$ system $M(0)\ddot q = [F,\ m_p g l\theta]^T$. Ignore friction here.

In the controller editor the numerically linearized model is available as the workspace variables **A_lin** and **B_lin**. They include viscous friction.`,
        R`Met toestand $\mathbf{x} = [x,\ \theta,\ \dot x,\ \dot\theta]^T$ is de dynamica $\dot{\mathbf{x}} = f(\mathbf{x}, F)$ met $\ddot q = M(q)^{-1}(\tau - C\dot q - g)$. Rond het rechtopstaande evenwicht $\mathbf{x}^* = 0$, $F^* = 0$:
$$\dot{\tilde{\mathbf x}} \approx A\tilde{\mathbf x} + B\tilde F,\qquad A = \left.\frac{\partial f}{\partial \mathbf x}\right|_{*},\quad B = \left.\frac{\partial f}{\partial F}\right|_{*}$$
Tip: in het evenwicht verdwijnen alle termen kwadratisch in snelheden, $\cos\theta \approx 1$, $\sin\theta \approx \theta$. Los het $2\times 2$ stelsel $M(0)\ddot q = [F,\ m_p g l\theta]^T$ op. Negeer hier de wrijving.

In de regelaar-editor is het numeriek gelineariseerde model beschikbaar als workspace-variabelen **A_lin** en **B_lin**. Daarin zit de viskeuze wrijving.`,
      ),
      fields: [
        f({ id: 'cp_A', label: tx('System matrix A', 'Systeemmatrix A'), prefix: 'A =', kind: 'expr', ref: R`\begin{bmatrix}0&0&1&0\\0&0&0&1\\0&-\frac{m_p g}{m_c}&0&0\\0&\frac{(m_c+m_p)g}{m_c l}&0&0\end{bmatrix}`, symbols: PAR, hint: tx(R`$\det M(0) = m_c m_p l^2$.`, R`$\det M(0) = m_c m_p l^2$.`) }),
        f({ id: 'cp_B', label: tx('Input matrix B', 'Ingangsmatrix B'), prefix: 'B =', kind: 'expr', ref: R`\begin{bmatrix}0\\0\\\frac{1}{m_c}\\-\frac{1}{m_c l}\end{bmatrix}`, symbols: PAR, hint: tx('Pushing the cart to +x makes θ̈ negative.', 'Duwen van de kar naar +x maakt θ̈ negatief.') }),
      ],
    },
    {
      id: 'lqr',
      title: tx('8 · LQR design & your first block diagram', '8 · LQR-ontwerp & je eerste blokschema'),
      body: tx(
        R`LQR finds $u = -K\mathbf{x}$ minimizing $J = \int_0^\infty \mathbf x^T Q \mathbf x + u^T R u\,dt$. The optimal gain follows from the **algebraic Riccati equation** for $P = P^T \succ 0$:
$$A^TP + PA - PBR^{-1}B^TP + Q = 0,\qquad K = R^{-1}B^TP$$
Type the Riccati equation and the gain formula below. Here $A, B, P, Q, R$ are matrices: the checker uses random matrices, so the order of factors matters.

**Build it yourself (Controller tab):**
1. Drag a **Plant sensors** block (Sources) and connect its output **x** to an **LQR controller** block (Controllers).
2. Add a **Constant** with value [0;0;0;0] to the *x_ref* input.
3. Connect the LQR output to a **Plant actuator** block (Sinks). Add a **Scope** to see signals.
4. Press ▶ and push the pole with the mouse.

Then experiment: increase $Q_{11}$ (cart position weight), decrease $R$, set the actuator limit to 5 N, add sensor noise (*realistic sensing*).`,
        R`LQR vindt $u = -K\mathbf{x}$ die $J = \int_0^\infty \mathbf x^T Q \mathbf x + u^T R u\,dt$ minimaliseert. De optimale versterking volgt uit de **algebraïsche Riccati-vergelijking** voor $P = P^T \succ 0$:
$$A^TP + PA - PBR^{-1}B^TP + Q = 0,\qquad K = R^{-1}B^TP$$
Typ hieronder de Riccati-vergelijking en de versterkingsformule. Hier zijn $A, B, P, Q, R$ matrices: de controle gebruikt willekeurige matrices, dus de volgorde van factoren telt.

**Bouw het zelf (tab Regelaar):**
1. Sleep een **Plant-sensoren**-blok (Bronnen) en verbind de uitgang **x** met een **LQR-regelaar**-blok (Regelaars).
2. Voeg een **Constante** met waarde [0;0;0;0] toe aan de ingang *x_ref*.
3. Verbind de LQR-uitgang met een **Plant-actuator**-blok (Uitgangen). Voeg een **Scope** toe om signalen te zien.
4. Druk op ▶ en duw de slinger met de muis.

Experimenteer daarna: verhoog $Q_{11}$ (gewicht karpositie), verlaag $R$, zet de actuatorlimiet op 5 N, voeg sensorruis toe (*realistische sensoren*).`,
      ),
      fields: [
        f({
          id: 'cp_riccati',
          label: tx('Continuous algebraic Riccati equation', 'Continue algebraïsche Riccati-vergelijking'),
          kind: 'equation',
          ref: R`A^TP + PA - PBR^{-1}B^TP + Q = 0`,
          symbols: [
            { tex: 'A', kind: 'mat', dims: [4, 4] },
            { tex: 'B', kind: 'mat', dims: [4, 1] },
            { tex: 'P', kind: 'symm', dims: [4, 4] },
            { tex: 'Q', kind: 'symm', dims: [4, 4] },
            { tex: 'R', kind: 'spd', dims: [1, 1] },
          ],
          hint: tx('Four terms; P is symmetric.', 'Vier termen; P is symmetrisch.'),
        }),
        f({
          id: 'cp_K',
          label: tx('Optimal gain', 'Optimale versterking'),
          prefix: 'K =',
          kind: 'expr',
          ref: R`R^{-1}B^TP`,
          symbols: [
            { tex: 'B', kind: 'mat', dims: [4, 1] },
            { tex: 'P', kind: 'symm', dims: [4, 4] },
            { tex: 'R', kind: 'spd', dims: [1, 1] },
          ],
          hint: tx('K is 1×4.', 'K is 1×4.'),
        }),
      ],
      actions: [
        { type: 'setParams', params: { theta0: 0.1, b_c: 0.1, F_c: 0, b_p: 0.002 }, label: tx('Reset parameters for balancing', 'Parameters resetten voor balanceren') },
        { type: 'loadExample', exampleId: 'cp-lqr', label: tx('Load solution: LQR block', 'Oplossing laden: LQR-blok') },
        { type: 'loadExample', exampleId: 'cp-gain', label: tx('Load solution: lqr() in init script + slider', 'Oplossing laden: lqr() in init-script + schuif') },
      ],
    },
    {
      id: 'swingup',
      title: tx('9 · Energy-based swing-up', '9 · Energiegebaseerd opzwaaien'),
      body: tx(
        R`LQR only works near upright. To swing up from hanging ($\theta = \pi$), shape the **pendulum energy**. With the cart acceleration $a = \ddot x$ as virtual input, the $\theta$-equation gives $\ddot\theta = (g\sin\theta - a\cos\theta)/l$.

1. Write the pendulum energy $E$ (pendulum only, relative to the pivot, $\theta = 0$ upright).
2. Differentiate along trajectories and substitute $\ddot\theta$: you get $\dot E$ as a function of $a$.
3. Choosing $a = k\,(E - E_{up})\,\dot\theta\cos\theta$ with $k > 0$ gives $\dot E = -k\,m_p l\,(E - E_{up})\,\dot\theta^2\cos^2\theta$, so $E \to E_{up}$. Lyapunov!
4. Map $a$ to $F$ by **partial feedback linearization**: solve the $x$-equation for $F$.
5. Switch to LQR when $\lvert\theta\rvert$ is small.

Load the example, set the **initial pole angle to 3.14** and press ▶. Read the MATLAB Function code: it is exactly this recipe.`,
        R`LQR werkt alleen dicht bij rechtop. Om op te zwaaien vanuit hangend ($\theta = \pi$) vormen we de **slingerenergie**. Met de karversnelling $a = \ddot x$ als virtuele ingang geeft de $\theta$-vergelijking $\ddot\theta = (g\sin\theta - a\cos\theta)/l$.

1. Schrijf de slingerenergie $E$ (alleen de slinger, t.o.v. het scharnier, $\theta = 0$ rechtop).
2. Differentieer langs trajecten en vul $\ddot\theta$ in: je krijgt $\dot E$ als functie van $a$.
3. De keuze $a = k\,(E - E_{up})\,\dot\theta\cos\theta$ met $k > 0$ geeft $\dot E = -k\,m_p l\,(E - E_{up})\,\dot\theta^2\cos^2\theta$, dus $E \to E_{up}$. Lyapunov!
4. Zet $a$ om naar $F$ met **partiële feedbacklinearisatie**: los de $x$-vergelijking op naar $F$.
5. Schakel over naar LQR als $\lvert\theta\rvert$ klein is.

Laad het voorbeeld, zet de **beginhoek op 3.14** en druk op ▶. Lees de code van de MATLAB-functie: het is precies dit recept.`,
      ),
      fields: [
        f({ id: 'cp_E', label: tx('Pendulum energy', 'Slingerenergie'), prefix: 'E =', kind: 'expr', ref: R`\frac{1}{2}m_p l^2\dot{\theta}^2 + m_p g l\cos\theta`, symbols: S_KIN, offset: true, hint: tx('Rotational kinetic energy about the pivot + potential energy.', 'Rotationele kinetische energie om het scharnier + potentiële energie.') }),
        f({
          id: 'cp_Edot',
          label: tx('Energy rate with cart acceleration a = ẍ', 'Energieverandering met karversnelling a = ẍ'),
          prefix: R`\dot E =`,
          kind: 'expr',
          ref: R`-m_p l\ddot{x}\dot{\theta}\cos\theta`,
          symbols: [...S_KIN, ...QDD],
          hint: tx(R`$\dot E = m_p l^2\dot\theta\ddot\theta - m_p g l\sin\theta\,\dot\theta$; substitute $\ddot\theta$.`, R`$\dot E = m_p l^2\dot\theta\ddot\theta - m_p g l\sin\theta\,\dot\theta$; vul $\ddot\theta$ in.`),
        }),
      ],
      actions: [
        { type: 'setParams', params: { theta0: 3.14 }, label: tx('Set initial angle to 3.14 (hanging)', 'Zet beginhoek op 3.14 (hangend)') },
        { type: 'loadExample', exampleId: 'cp-swingup', label: tx('Load solution: swing-up + LQR', 'Oplossing laden: opzwaaien + LQR') },
      ],
    },
    {
      id: 'beyond',
      title: tx('10 · Going further', '10 · Verder gaan'),
      body: tx(
        R`Ideas to practise:
- **Friction compensation**: set $F_c = 2$ N. LQR now shows a steady-state cart offset or a limit cycle. Add a feed-forward $\hat F_c\,\mathrm{sign}(\dot x)$ (Math function *sign* + Gain + Sum).
- **Realistic sensing** (toolbar): velocities are now finite differences of noisy, quantized encoders. Add a **Low-pass filter**, or build an observer with a **State space** block: $\dot{\hat x} = A\hat x + Bu + L(y - C\hat x)$.
- **Actuator delay**: set 20 ms of delay. How much delay can your LQR tolerate? Compare with the phase margin.
- **PID only on θ** (example): why does the cart drift? Think about controllability of a SISO loop on an underactuated system.
- **Export** your controller to MATLAB (toolbar) and run it there with ode45.
- **Record** a run (⏺), then replay it and scrub through time.`,
        R`Ideeën om te oefenen:
- **Wrijvingscompensatie**: zet $F_c = 2$ N. LQR geeft nu een blijvende karafwijking of een limietcyclus. Voeg een feed-forward $\hat F_c\,\mathrm{sign}(\dot x)$ toe (Wiskundige functie *sign* + Versterking + Optelling).
- **Realistische sensoren** (werkbalk): snelheden zijn nu differenties van ruizige, gekwantiseerde encoders. Voeg een **Laagdoorlaatfilter** toe, of bouw een waarnemer met een **Toestandsruimte**-blok: $\dot{\hat x} = A\hat x + Bu + L(y - C\hat x)$.
- **Actuatorvertraging**: stel 20 ms in. Hoeveel vertraging kan je LQR aan? Vergelijk met de fasemarge.
- **PID alleen op θ** (voorbeeld): waarom drijft de kar weg? Denk aan regelbaarheid van een SISO-lus op een onderactueerd systeem.
- **Exporteer** je regelaar naar MATLAB (werkbalk) en draai hem daar met ode45.
- **Neem** een run op (⏺), speel hem daarna af en scrol door de tijd.`,
      ),
      actions: [{ type: 'loadExample', exampleId: 'cp-pid', label: tx('Load example: PID on θ only', 'Voorbeeld laden: PID alleen op θ') }],
    },
  ],
};

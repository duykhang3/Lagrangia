import type { FieldDef, SymDef } from '../latex/checker';
import { tx, type Tutorial } from './types';

const R = String.raw;
const n = 7;
const m = 6;
const vec = (tex: string, dim = n, desc?: [string, string]): SymDef => ({ tex, kind: 'vec', dims: [dim, 1], desc: desc ? tx(desc[0], desc[1]) : undefined });
const Qv = [vec('q'), vec('\\dot{q}'), vec('\\ddot{q}')];
const Mf: SymDef = { tex: 'M', kind: 'spd', dims: [n, n], fn: true, desc: tx('mass matrix M(q)', 'massamatrix M(q)') };
const Cf: SymDef = { tex: 'C', kind: 'mat', dims: [n, n], fn: true, desc: tx('Coriolis matrix C(q,q̇)', 'Coriolismatrix C(q,q̇)') };
const gf: SymDef = { tex: 'g', kind: 'vec', dims: [n, 1], fn: true, desc: tx('gravity torques g(q)', 'zwaartekrachtkoppels g(q)') };
const Jf: SymDef = { tex: 'J', kind: 'mat', dims: [m, n], fn: true, desc: tx('geometric Jacobian J(q), 6×7', 'geometrische Jacobiaan J(q), 6×7') };
const Jdf: SymDef = { tex: '\\dot{J}', kind: 'mat', dims: [m, n], fn: true };
const tau = vec('\\tau', n, ['joint torques', 'gewrichtskoppels']);
const tauf = vec('\\tau_f', n, ['friction torques', 'wrijvingskoppels']);
const f = (d: FieldDef) => d;

export const pandaTutorial: Tutorial = {
  system: 'panda',
  steps: [
    {
      id: 'intro',
      title: tx('Welcome: Franka FR3 / Panda', 'Welkom: Franka FR3 / Panda'),
      body: tx(
        R`A 7-DOF torque-controlled arm. Kinematics use Franka's published **modified DH** parameters; dynamics are computed with the **recursive Newton–Euler algorithm** (RNEA) using approximate identified inertial parameters (MuJoCo Menagerie / Gaz et al. 2019), plus the Franka hand and reflected rotor inertia (*armature*).

In this tutorial the symbols are **matrices and vectors** ($q\in\mathbb R^7$, $M\in\mathbb R^{7\times7}$, $J\in\mathbb R^{6\times7}$). The checker evaluates your expression with random matrices, so **order of multiplication and transposes matter**, exactly like in real code. You may write $M(q)$ or just $M$.

Interaction: drag any link with the mouse, or move the green target gizmo when the controller contains a *3D target* block. Turn on the block/wall in *Parameters → Contact* to experiment with contact.`,
        R`Een 7-DOF koppelgeregelde arm. De kinematica gebruikt Franka's gepubliceerde **gemodificeerde DH**-parameters; de dynamica wordt berekend met het **recursieve Newton–Euler-algoritme** (RNEA) met benaderde geïdentificeerde massaparameters (MuJoCo Menagerie / Gaz et al. 2019), plus de Franka-hand en gereflecteerde rotortraagheid (*armature*).

In deze tutorial zijn de symbolen **matrices en vectoren** ($q\in\mathbb R^7$, $M\in\mathbb R^{7\times7}$, $J\in\mathbb R^{6\times7}$). De controle evalueert je uitdrukking met willekeurige matrices, dus **volgorde van vermenigvuldigen en transponeren telt**, net als in echte code. Je mag $M(q)$ of gewoon $M$ schrijven.

Interactie: sleep een schakel met de muis, of verplaats het groene doel als de regelaar een *3D-doel*-blok bevat. Zet het blok/de muur aan in *Parameters → Contact* om met contact te experimenteren.`,
      ),
    },
    {
      id: 'kin',
      title: tx('1 · Differential kinematics', '1 · Differentiële kinematica'),
      body: tx(
        R`The geometric Jacobian maps joint velocities to the TCP twist $\dot x = [v;\ \omega] \in \mathbb R^6$. For a revolute joint $i$ with axis $z_i$ through $o_i$, column $i$ is
$$J_i = \begin{bmatrix} z_i \times (p_{tcp} - o_i) \\ z_i \end{bmatrix}$$
Differentiate once more to get the task-space acceleration (product rule!).`,
        R`De geometrische Jacobiaan beeldt gewrichtssnelheden af op de TCP-twist $\dot x = [v;\ \omega] \in \mathbb R^6$. Voor een draaigewricht $i$ met as $z_i$ door $o_i$ is kolom $i$
$$J_i = \begin{bmatrix} z_i \times (p_{tcp} - o_i) \\ z_i \end{bmatrix}$$
Differentieer nog eens voor de versnelling in taakruimte (productregel!).`,
      ),
      fields: [
        f({ id: 'pa_xd', label: tx('Task-space velocity', 'Snelheid in taakruimte'), kind: 'equation', ref: R`\dot{x} = J\dot{q}`, symbols: [vec('\\dot{x}', m), ...Qv, Jf], hint: tx('One matrix-vector product.', 'Eén matrix-vectorproduct.') }),
        f({ id: 'pa_xdd', label: tx('Task-space acceleration', 'Versnelling in taakruimte'), kind: 'equation', ref: R`\ddot{x} = J\ddot{q} + \dot{J}\dot{q}`, symbols: [vec('\\ddot{x}', m), ...Qv, Jf, Jdf], hint: tx('d/dt (J q̇)', 'd/dt (J q̇)') }),
      ],
    },
    {
      id: 'dyn',
      title: tx('2 · Rigid-body dynamics', '2 · Star-lichaamsdynamica'),
      body: tx(
        R`For a serial manipulator the Lagrangian approach gives the familiar
$$\tau = M(q)\ddot q + C(q,\dot q)\dot q + g(q) + \tau_f$$
with $T = \tfrac12\dot q^T M(q)\dot q$. In practice nobody derives $M$ for 7 joints by hand: **RNEA** computes $\tau$ for given $(q,\dot q,\ddot q)$ in $O(n)$; calling it with $\dot q = 0$, $g = 0$, $\ddot q = e_j$ gives column $j$ of $M$. That is exactly what the *Mass matrix*, *Coriolis* and *Gravity* blocks do.

**Friction**: per joint viscous + Coulomb, $\tau_f = D\dot q + F_c\,\mathrm{sign}(\dot q)$ with diagonal $D$, $F_c$ (sign applied element-wise).`,
        R`Voor een seriële manipulator geeft Lagrange de bekende
$$\tau = M(q)\ddot q + C(q,\dot q)\dot q + g(q) + \tau_f$$
met $T = \tfrac12\dot q^T M(q)\dot q$. In de praktijk leidt niemand $M$ voor 7 gewrichten met de hand af: **RNEA** berekent $\tau$ voor gegeven $(q,\dot q,\ddot q)$ in $O(n)$; met $\dot q = 0$, $g = 0$, $\ddot q = e_j$ krijg je kolom $j$ van $M$. Dat is precies wat de blokken *Massamatrix*, *Coriolis* en *Zwaartekracht* doen.

**Wrijving**: per gewricht viskeus + Coulomb, $\tau_f = D\dot q + F_c\,\mathrm{sign}(\dot q)$ met diagonale $D$, $F_c$ (sign element-gewijs).`,
      ),
      fields: [
        f({ id: 'pa_T', label: tx('Kinetic energy', 'Kinetische energie'), prefix: 'T =', kind: 'expr', ref: R`\frac{1}{2}\dot{q}^TM\dot{q}`, symbols: [...Qv, Mf], hint: tx('A quadratic form; the result is a scalar.', 'Een kwadratische vorm; het resultaat is een scalar.') }),
        f({ id: 'pa_eom', label: tx('Equations of motion (with friction)', 'Bewegingsvergelijkingen (met wrijving)'), kind: 'equation', ref: R`\tau = M\ddot{q} + C\dot{q} + g + \tau_f`, symbols: [...Qv, Mf, Cf, gf, tau, tauf], hint: tx('Four terms on the right.', 'Vier termen rechts.') }),
        f({
          id: 'pa_fric',
          label: tx('Friction model', 'Wrijvingsmodel'),
          kind: 'equation',
          ref: R`\tau_f = D\dot{q} + F_c\operatorname{sign}(\dot{q})`,
          symbols: [...Qv, tauf, { tex: 'D', kind: 'diag', dims: [n, n] }, { tex: 'F_c', kind: 'diag', dims: [n, n] }],
          hint: tx('Diagonal matrices times vectors.', 'Diagonale matrices maal vectoren.'),
        }),
      ],
    },
    {
      id: 'pd',
      title: tx('3 · PD + gravity compensation', '3 · PD + zwaartekrachtcompensatie'),
      body: tx(
        R`The simplest stable regulator: $V = \tfrac12\dot q^TM\dot q + \tfrac12 e^TK_pe$ is a Lyapunov function when we cancel gravity and add PD feedback (use $\dot M - 2C$ skew-symmetric!). Write the control law with $e = q_d - q$ (constant $q_d$).

Load the solution, then try **payload = 2 kg** in the parameters: the controller's model does not know the payload, so you'll see a steady-state error. Add an integrator to fix it.`,
        R`De eenvoudigste stabiele regelaar: $V = \tfrac12\dot q^TM\dot q + \tfrac12 e^TK_pe$ is een Lyapunov-functie als we zwaartekracht compenseren en PD-terugkoppeling toevoegen (gebruik dat $\dot M - 2C$ scheef-symmetrisch is!). Schrijf de regelwet met $e = q_d - q$ (constante $q_d$).

Laad de oplossing en probeer dan **last = 2 kg** in de parameters: het model van de regelaar kent de last niet, dus je ziet een blijvende fout. Voeg een integrator toe om dat op te lossen.`,
      ),
      fields: [
        f({
          id: 'pa_pd',
          label: tx('PD + gravity compensation', 'PD + zwaartekrachtcompensatie'),
          kind: 'equation',
          ref: R`\tau = K_p(q_d - q) - K_d\dot{q} + g`,
          symbols: [...Qv, vec('q_d'), gf, tau, { tex: 'K_p', kind: 'diag', dims: [n, n] }, { tex: 'K_d', kind: 'diag', dims: [n, n] }, { tex: 'e', kind: 'vec', dims: [n, 1], alias: 'q_d - q' }],
          hint: tx('Three terms.', 'Drie termen.'),
        }),
      ],
      actions: [{ type: 'loadExample', exampleId: 'pa-pd', label: tx('Load solution: PD + gravity compensation', 'Oplossing laden: PD + zwaartekrachtcompensatie') }],
    },
    {
      id: 'ct',
      title: tx('4 · Computed torque (inverse dynamics control)', '4 · Computed torque (inverse-dynamicaregeling)'),
      body: tx(
        R`Choose $\tau$ such that the closed loop becomes $\ddot e + K_d\dot e + K_p e = 0$ with $e = q_d - q$: **feedback linearization**. Substitute $\ddot q = \ddot q_d + K_d\dot e + K_pe$ into the equations of motion (ignore friction).`,
        R`Kies $\tau$ zodat de gesloten lus $\ddot e + K_d\dot e + K_p e = 0$ wordt met $e = q_d - q$: **feedbacklinearisatie**. Vul $\ddot q = \ddot q_d + K_d\dot e + K_pe$ in de bewegingsvergelijkingen in (negeer wrijving).`,
      ),
      fields: [
        f({
          id: 'pa_ct',
          label: tx('Computed-torque law', 'Computed-torque-regelwet'),
          kind: 'equation',
          ref: R`\tau = M(\ddot{q}_d + K_d\dot{e} + K_pe) + C\dot{q} + g`,
          symbols: [...Qv, vec('q_d'), vec('\\dot{q}_d'), vec('\\ddot{q}_d'), Mf, Cf, gf, tau, { tex: 'K_p', kind: 'diag', dims: [n, n] }, { tex: 'K_d', kind: 'diag', dims: [n, n] }, { tex: 'e', kind: 'vec', dims: [n, 1], alias: 'q_d - q' }, { tex: '\\dot{e}', kind: 'vec', dims: [n, 1], alias: '\\dot{q}_d - \\dot{q}' }],
          hint: tx('M multiplies the desired acceleration.', 'M vermenigvuldigt de gewenste versnelling.'),
        }),
      ],
      actions: [{ type: 'loadExample', exampleId: 'pa-ct', label: tx('Load solution: computed torque', 'Oplossing laden: computed torque') }],
    },
    {
      id: 'imp',
      title: tx('5 · Cartesian impedance & null space', '5 · Cartesische impedantie & nulruimte'),
      body: tx(
        R`Make the TCP behave like a spring–damper towards $x_d$: the Cartesian wrench
$$F = K_p(x_d - x) - K_d\dot x$$
maps to joint torques through the **Jacobian transpose** (virtual work again!), plus gravity compensation. With 7 joints and a 6-D task there is one redundant DOF: project a posture torque $\tau_0$ into the **null space** so it does not disturb the task:
$$\tau = J^TF + g + N\tau_0,\qquad N = I - J^T(J^{\dagger})^T$$
Push the target into the block (*Parameters → Contact*): the contact force equals the spring force $K_p(x_d - x)$ at equilibrium. That is how impedance control limits interaction forces.`,
        R`Laat de TCP zich als veer–demper richting $x_d$ gedragen: de Cartesische wrench
$$F = K_p(x_d - x) - K_d\dot x$$
gaat via de **getransponeerde Jacobiaan** naar gewrichtskoppels (weer virtuele arbeid!), plus zwaartekrachtcompensatie. Met 7 gewrichten en een 6-D taak is er één redundante DOF: projecteer een houdingskoppel $\tau_0$ in de **nulruimte** zodat het de taak niet verstoort:
$$\tau = J^TF + g + N\tau_0,\qquad N = I - J^T(J^{\dagger})^T$$
Duw het doel in het blok (*Parameters → Contact*): de contactkracht is in evenwicht gelijk aan de veerkracht $K_p(x_d - x)$. Zo begrenst impedantieregeling interactiekrachten.`,
      ),
      fields: [
        f({
          id: 'pa_F',
          label: tx('Cartesian spring–damper', 'Cartesische veer–demper'),
          prefix: 'F =',
          kind: 'expr',
          ref: R`K_p(x_d - x) - K_d\dot{x}`,
          symbols: [vec('x', m), vec('x_d', m), vec('\\dot{x}', m), { tex: 'K_p', kind: 'diag', dims: [m, m] }, { tex: 'K_d', kind: 'diag', dims: [m, m] }],
          hint: tx('6×1 result.', '6×1 resultaat.'),
        }),
        f({
          id: 'pa_tauimp',
          label: tx('Impedance control torque with null-space posture term', 'Impedantiekoppel met nulruimte-houdingsterm'),
          kind: 'equation',
          ref: R`\tau = J^TF + g + (I - J^T(J^{\dagger})^T)\tau_0`,
          symbols: [vec('q'), Jf, gf, tau, vec('F', m), vec('\\tau_0'), { tex: 'I', kind: 'eye', dims: [n, n] }],
          hint: tx(R`$J^\dagger = J^T(JJ^T)^{-1}$; any equivalent form is accepted.`, R`$J^\dagger = J^T(JJ^T)^{-1}$; elke equivalente vorm wordt geaccepteerd.`),
        }),
      ],
      actions: [
        { type: 'setParams', params: { box_on: true, floor_on: true }, label: tx('Enable table & block contact', 'Contact met tafel & blok aan') },
        { type: 'loadExample', exampleId: 'pa-imp', label: tx('Load solution: impedance control', 'Oplossing laden: impedantieregeling') },
      ],
    },
    {
      id: 'contact',
      title: tx('6 · How contact is modelled', '6 · Hoe contact gemodelleerd is'),
      body: tx(
        R`The simulator uses **penalty contact** on spheres attached to the links: for penetration depth $\delta$ along normal $n$,
$$F_n = \max(0,\ k\,\delta - d\,\dot\delta),\qquad F_t = -\mu F_n\,\frac{v_t}{\lVert v_t\rVert}\tanh\!\left(\frac{\lVert v_t\rVert}{v_\varepsilon}\right)$$
and the resulting force enters the dynamics as $\tau_c = J_c(q)^T F_c$, with $J_c$ the point Jacobian of the contact point. The same mechanism (an external force mapped with $J^T$) is used for your mouse drag and for friction/drag on the pendulums.

Experiments:
- Increase the contact stiffness and watch the required time step (the simulation uses 0.5 ms).
- Lower $\mu$ and slide the TCP over the block.
- Compare impedance control with the PD example when pushing against the wall: which one produces larger forces?`,
        R`De simulator gebruikt **penalty-contact** op bollen die aan de schakels vastzitten: voor indringdiepte $\delta$ langs normaal $n$,
$$F_n = \max(0,\ k\,\delta - d\,\dot\delta),\qquad F_t = -\mu F_n\,\frac{v_t}{\lVert v_t\rVert}\tanh\!\left(\frac{\lVert v_t\rVert}{v_\varepsilon}\right)$$
en de resulterende kracht komt in de dynamica als $\tau_c = J_c(q)^T F_c$, met $J_c$ de punt-Jacobiaan van het contactpunt. Hetzelfde mechanisme (externe kracht via $J^T$) wordt gebruikt voor het slepen met de muis en voor wrijving/luchtweerstand bij de slingers.

Experimenten:
- Verhoog de contactstijfheid en let op de benodigde tijdstap (de simulatie gebruikt 0,5 ms).
- Verlaag $\mu$ en schuif de TCP over het blok.
- Vergelijk impedantieregeling met het PD-voorbeeld bij duwen tegen de muur: welke geeft grotere krachten?`,
      ),
      actions: [{ type: 'setParams', params: { wall_on: true }, label: tx('Enable the wall', 'Muur aanzetten') }],
    },
  ],
};

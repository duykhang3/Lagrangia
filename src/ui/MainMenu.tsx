import { SYSTEM_IDS, SYSTEMS } from '../core/systems';
import { allFields } from '../core/tutorials';
import type { SystemId } from '../core/types';
import { download, LangSwitch, pickFile, Tex, toast, ToastHost } from './common';
import { useT } from './i18n';
import { useApp } from './store';

const DESC: Record<SystemId, { en: string; nl: string; chips: string[] }> = {
  cartpole: {
    en: 'The classic underactuated benchmark. Derive the Lagrangian, add Coulomb & viscous friction, linearize, design LQR and an energy-based swing-up.',
    nl: 'De klassieke onderactueerde benchmark. Leid de Lagrangiaan af, voeg Coulomb- & viskeuze wrijving toe, lineariseer, ontwerp LQR en energiegebaseerd opzwaaien.',
    chips: ['Lagrange', 'Friction', 'Jacobian', 'LQR', 'Swing-up'],
  },
  furuta: {
    en: 'Rotary inverted pendulum with 3D gyroscopic coupling. Non-minimum phase dynamics, Christoffel symbols and energy shaping.',
    nl: 'Roterende omgekeerde slinger met 3D gyroscopische koppeling. Niet-minimumfase dynamica, Christoffelsymbolen en energievorming.',
    chips: ['Rotational dynamics', 'Coriolis', 'LQR', 'Swing-up'],
  },
  panda: {
    en: 'Franka FR3 / Panda 7-DOF arm with RNEA dynamics and contact. Jacobians, computed torque, Cartesian impedance and null-space control.',
    nl: 'Franka FR3 / Panda 7-DOF arm met RNEA-dynamica en contact. Jacobianen, computed torque, Cartesische impedantie en nulruimteregeling.',
    chips: ['M(q), C, g', 'Jacobian', 'Computed torque', 'Impedance', 'Contact'],
  },
};

function Art({ id }: { id: SystemId }) {
  const stroke = '#76e4c3';
  if (id === 'cartpole')
    return (
      <svg width="260" height="170" viewBox="0 0 260 170">
        <line x1="10" y1="140" x2="250" y2="140" stroke="#3c4d63" strokeWidth="4" />
        <rect x="95" y="112" width="70" height="28" rx="4" fill="#2b3b50" stroke="#5aa9ff" />
        <circle cx="110" cy="144" r="6" fill="#0d1117" stroke="#8fb4d9" />
        <circle cx="150" cy="144" r="6" fill="#0d1117" stroke="#8fb4d9" />
        <line x1="130" y1="118" x2="160" y2="30" stroke={stroke} strokeWidth="5" strokeLinecap="round" />
        <circle cx="160" cy="30" r="11" fill="#ff9f5a" />
        <path d="M130 70 A 48 48 0 0 1 145 74" stroke="#ffb454" fill="none" strokeDasharray="3 3" />
        <text x="148" y="66" fill="#ffb454" fontSize="14" fontStyle="italic">θ</text>
        <path d="M60 126 h30" stroke="#ff6b6b" strokeWidth="3" markerEnd="url(#a)" />
        <text x="50" y="118" fill="#ff6b6b" fontSize="14" fontStyle="italic">F</text>
        <defs>
          <marker id="a" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto">
            <path d="M0,0 L8,4 L0,8 z" fill="#ff6b6b" />
          </marker>
        </defs>
      </svg>
    );
  if (id === 'furuta')
    return (
      <svg width="260" height="170" viewBox="0 0 260 170">
        <ellipse cx="110" cy="150" rx="60" ry="10" fill="#1f2b3a" />
        <rect x="95" y="95" width="30" height="55" rx="4" fill="#2b3b50" stroke="#5aa9ff" />
        <ellipse cx="110" cy="92" rx="70" ry="18" fill="none" stroke="#3c4d63" strokeDasharray="4 4" />
        <line x1="110" y1="92" x2="180" y2="100" stroke="#8fb4d9" strokeWidth="7" strokeLinecap="round" />
        <line x1="180" y1="100" x2="195" y2="25" stroke={stroke} strokeWidth="5" strokeLinecap="round" />
        <circle cx="195" cy="25" r="6" fill="#ff9f5a" />
        <text x="140" y="125" fill="#ffb454" fontSize="14" fontStyle="italic">θ₁</text>
        <text x="200" y="70" fill="#ffb454" fontSize="14" fontStyle="italic">θ₂</text>
      </svg>
    );
  return (
    <svg width="260" height="170" viewBox="0 0 260 170">
      <rect x="20" y="150" width="220" height="8" fill="#3c4d63" />
      <rect x="70" y="120" width="34" height="30" rx="6" fill="#e8edf2" />
      <line x1="87" y1="120" x2="87" y2="80" stroke="#e8edf2" strokeWidth="18" strokeLinecap="round" />
      <line x1="87" y1="80" x2="150" y2="40" stroke="#e8edf2" strokeWidth="16" strokeLinecap="round" />
      <line x1="150" y1="40" x2="190" y2="90" stroke="#e8edf2" strokeWidth="13" strokeLinecap="round" />
      <circle cx="87" cy="80" r="11" fill="#2b3b50" />
      <circle cx="150" cy="40" r="10" fill="#2b3b50" />
      <circle cx="190" cy="90" r="8" fill="#2b3b50" />
      <line x1="184" y1="98" x2="182" y2="116" stroke="#9aa" strokeWidth="4" />
      <line x1="198" y1="98" x2="200" y2="116" stroke="#9aa" strokeWidth="4" />
      <rect x="160" y="125" width="60" height="25" fill="#33465f" stroke="#5aa9ff" />
      <circle cx="191" cy="122" r="5" fill="none" stroke="#76e4c3" strokeWidth="2" />
    </svg>
  );
}

export function MainMenu() {
  const t = useT();
  const open = useApp((s) => s.open);
  const systems = useApp((s) => s.systems);
  const resetAll = useApp((s) => s.resetAll);
  const importAll = useApp((s) => s.importAll);

  return (
    <div className="menu">
      <div className="menu-inner">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div className="brand">
            <h1>Lagrangia</h1>
            <span className="tag">{t('appTagline')}</span>
          </div>
          <LangSwitch />
        </div>
        <p className="intro">{t('menuIntro')}</p>
        <div className="eq-banner">
          <Tex tex={String.raw`\frac{d}{dt}\frac{\partial L}{\partial \dot q} - \frac{\partial L}{\partial q} = Q \quad\Longrightarrow\quad \tau = M(q)\ddot q + C(q,\dot q)\dot q + g(q) + \tau_f`} />
        </div>
        <div className="cards">
          {SYSTEM_IDS.map((id) => {
            const m = SYSTEMS[id];
            const fields = allFields(id);
            const done = fields.filter((f) => systems[id].results[f.id]?.status === 'correct').length;
            const started = Object.keys(systems[id].fields).length > 0;
            return (
              <div className="card" key={id} onClick={() => open(id)}>
                <div className="art">
                  <Art id={id} />
                </div>
                <div className="body">
                  <h2>{t.l(m.name)}</h2>
                  <p>{DESC[id][t.lang]}</p>
                  <div className="chips">
                    <span className="chip">
                      {m.n} {t('dof')}
                    </span>
                    <span className="chip">
                      {m.nu} {t('actuators')}
                    </span>
                    {DESC[id].chips.map((c) => (
                      <span className="chip" key={c}>
                        {c}
                      </span>
                    ))}
                  </div>
                  <div className="spacer" />
                  <div className="small muted">
                    {t('progress')}: {done} / {fields.length}
                  </div>
                  <div className="progressbar">
                    <div style={{ width: `${(100 * done) / Math.max(1, fields.length)}%` }} />
                  </div>
                  <div className="row">
                    <button className="primary" onClick={(e) => (e.stopPropagation(), open(id))}>
                      {started ? t('continue') : t('open')} →
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        <div className="menu-footer">
          <span className="muted small">{t('saved')}</span>
          <span className="spacer" />
          <button onClick={() => download('lagrangia-progress.json', JSON.stringify(useApp.getState(), null, 1), 'application/json')}>⬇ {t('exportWorkspace')}</button>
          <button
            onClick={async () => {
              const txt = await pickFile('.json,application/json');
              if (!txt) return;
              try {
                importAll(JSON.parse(txt));
                toast('✔');
              } catch (e) {
                alert((e as Error).message);
              }
            }}
          >
            ⬆ {t('importWorkspace')}
          </button>
          <button className="danger" onClick={() => confirm(t('confirmResetAll')) && resetAll()}>
            ⟲ {t('resetProgress')}
          </button>
        </div>
      </div>
      <ToastHost />
    </div>
  );
}

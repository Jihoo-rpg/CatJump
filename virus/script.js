/* =====================================================================
   VIRUS SIMULATOR  —  script.js
   ---------------------------------------------------------------------
   목차
     0. 기본 도구 (숫자 표시, 랜덤 등)
     1. 정적 데이터 (국가, 항공/항구 노선, 바이러스 종류, 업그레이드, 이벤트)
     2. 게임 상태 (새 게임 만들기, 저장/불러오기)
     3. 시뮬레이션 (하루 진행: 국내 확산, 국가 간 이동, AI 국가, 연구, 승패)
     4. 지도 (그리기, 확대/축소/드래그, 색상, 이동 애니메이션, 포인트 방울)
     5. 화면 갱신 (상단 통계, 왼쪽 바이러스, 오른쪽 국가, 그래프, 뉴스)
     6. 메뉴/팝업 (시작 화면, 새 게임, 설정, 이벤트, 결과)
     7. 게임 루프와 시작
   ※ 모든 바이러스 특성은 게임용 가상 능력입니다. 현실의 병원체와 관계없습니다.
   ===================================================================== */
'use strict';

/* ===================== 0. 기본 도구 ===================== */
const $ = id => document.getElementById(id);
const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtN = n => Math.round(Math.max(0, n)).toLocaleString('ko-KR');
/** 큰 숫자를 '12.3억', '4.5만'처럼 짧게 */
function fmtK(n) {
  n = Math.max(0, n);
  if (n >= 1e8) return (n / 1e8).toFixed(n >= 1e9 ? 1 : 2).replace(/\.?0+$/, '') + '억';
  if (n >= 1e4) return (n / 1e4).toFixed(n >= 1e6 ? 0 : 1).replace(/\.0$/, '') + '만';
  return fmtN(n);
}
function fmtP(v) { if (v <= 0) return '0%'; if (v < 0.01) return '<0.01%'; return v.toFixed(v < 10 ? 2 : 1) + '%'; }
function weighted(list, w) { let t = 0; for (const x of list) t += w(x); let r = Math.random() * t; for (const x of list) { r -= w(x); if (r <= 0) return x; } return list[list.length - 1]; }

const SAVE_KEY = 'virussim_save_v1';
const SET_KEY = 'virussim_settings_v1';
const START_DATE = new Date(2027, 0, 1);

/* ===================== 1. 정적 데이터 ===================== */
const WD = window.WORLD_DATA;           // data/world.js 에서 불러옴
const MAP_OK = !!(WD && Array.isArray(WD.countries) && WD.countries.length > 50);

/** 국가 기본 정보 (게임 중에는 바뀌지 않는 값) */
const C = MAP_OK ? WD.countries.map((c, i) => ({
  ...c, i,
  N: Math.max(1000, c.pop),                                   // 인구
  econ: clamp(Math.log10(c.gdp + 10) / 7, 0.12, 1),           // 경제력 0~1
  clim: Math.abs(c.lat) > 45 ? 'cold' : Math.abs(c.lat) < 23 ? 'hot' : 'mild',
  medBase: [0.15, 0.28, 0.42, 0.6, 0.75][c.inc - 1],          // 처음 의료 수준
  medCap: [0.55, 0.66, 0.78, 0.9, 0.96][c.inc - 1],           // 확충 가능한 최대 의료 수준
})) : [];
const CI = {}; C.forEach(c => { CI[c.id] = c.i; });
const WORLD_POP = C.reduce((s, c) => s + c.N, 0);
const has = id => CI[id] !== undefined;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/* ---- 항공 노선: 경제 규모가 큰 나라와 인구가 많은 나라에 공항 ---- */
const MEGA = ['USA', 'GBR', 'FRA', 'DEU', 'ARE', 'CHN', 'JPN', 'KOR', 'IND', 'BRA', 'ZAF', 'AUS', 'RUS', 'TUR', 'EGY', 'MEX', 'QAT', 'NLD', 'THA', 'CAN'].filter(has);
const AIRPORT = new Set();
[...C].sort((a, b) => b.gdp - a.gdp).slice(0, 62).forEach(c => AIRPORT.add(c.i));
C.forEach(c => { if (c.pop > 25e6) AIRPORT.add(c.i); });
MEGA.forEach(id => AIRPORT.add(CI[id]));
const AIR_ROUTES = new Map();               // 국가 번호 -> 연결된 공항 국가들
function addRoute(map, a, b) { if (a === b) return; if (!map.has(a)) map.set(a, new Set()); if (!map.has(b)) map.set(b, new Set()); map.get(a).add(b); map.get(b).add(a); }
(function buildAir() {
  const megaI = MEGA.map(id => CI[id]);
  for (let i = 0; i < 12 && i < megaI.length; i++) for (let j = i + 1; j < 12 && j < megaI.length; j++) addRoute(AIR_ROUTES, megaI[i], megaI[j]);
  for (const a of AIRPORT) {
    const near = megaI.filter(m => m !== a).sort((x, y) => dist(C[a], C[x]) - dist(C[a], C[y])).slice(0, 3);
    near.forEach(m => addRoute(AIR_ROUTES, a, m));
  }
})();

/* ---- 항구 노선 ---- */
const PORT_IDS = ['USA', 'CHN', 'JPN', 'KOR', 'MYS', 'IDN', 'IND', 'NLD', 'DEU', 'GBR', 'FRA', 'ESP', 'ITA', 'BRA', 'ARG', 'ZAF', 'NGA', 'EGY', 'SAU', 'ARE', 'AUS', 'CAN', 'MEX', 'RUS', 'TUR', 'GRC', 'NOR', 'CHL', 'PER', 'VNM', 'THA', 'PHL', 'TWN', 'KEN', 'TZA', 'MAR', 'PAK', 'BGD', 'LKA', 'NZL', 'PRT', 'BEL', 'POL', 'SWE', 'DNK', 'IRN', 'OMN', 'COL', 'VEN', 'CUB', 'PAN', 'SEN', 'GHA', 'AGO', 'MOZ', 'MDG', 'ISL', 'FJI', 'PNG', 'URY'].filter(has);
const PORT = new Set(PORT_IDS.map(id => CI[id]));
const SEA_ROUTES = new Map();
const SEA_LINKS = [['GBR', 'FRA'], ['GBR', 'IRL'], ['GBR', 'NLD'], ['GBR', 'BEL'], ['JPN', 'KOR'], ['JPN', 'CHN'], ['JPN', 'TWN'], ['KOR', 'CHN'], ['TWN', 'CHN'], ['TWN', 'PHL'], ['PHL', 'IDN'], ['PHL', 'MYS'], ['IDN', 'AUS'], ['PNG', 'AUS'], ['AUS', 'NZL'], ['NZL', 'FJI'], ['FJI', 'VUT'], ['VUT', 'NCL'], ['NCL', 'AUS'], ['SLB', 'PNG'], ['LKA', 'IND'], ['MDG', 'MOZ'], ['MDG', 'ZAF'], ['CUB', 'USA'], ['CUB', 'MEX'], ['CUB', 'JAM'], ['CUB', 'HTI'], ['CUB', 'BHS'], ['BHS', 'USA'], ['JAM', 'HTI'], ['DOM', 'PRI'], ['PRI', 'USA'], ['TTO', 'VEN'], ['ISL', 'NOR'], ['ISL', 'GBR'], ['GRL', 'CAN'], ['GRL', 'ISL'], ['DNK', 'SWE'], ['DNK', 'NOR'], ['SWE', 'FIN'], ['EST', 'FIN'], ['ITA', 'TUN'], ['ITA', 'LBY'], ['ESP', 'MAR'], ['GRC', 'TUR'], ['CYP', 'TUR'], ['CYP', 'LBN'], ['EGY', 'SAU'], ['YEM', 'DJI'], ['YEM', 'SOM'], ['SAU', 'ERI'], ['QAT', 'ARE'], ['IRN', 'ARE'], ['OMN', 'PAK'], ['TLS', 'IDN'], ['TLS', 'AUS'], ['BRN', 'MYS'], ['FLK', 'ARG'], ['ATF', 'MDG'], ['SOL', 'YEM'], ['SAH', 'MAR'], ['NCL', 'NZL']];
SEA_LINKS.forEach(([a, b]) => { if (has(a) && has(b)) addRoute(SEA_ROUTES, CI[a], CI[b]); });
for (const a of PORT) [...PORT].filter(b => b !== a).sort((x, y) => dist(C[a], C[x]) - dist(C[a], C[y])).slice(0, 3).forEach(b => addRoute(SEA_ROUTES, a, b));

/* ---- 바이러스 종류 (가상) ---- */
const VTYPES = {
  basic: { n: '기본 바이러스', ic: '🦠', d: '모든 능력이 고르게 균형 잡힌 기본형. 처음 해 보기 좋아요.', tags: ['균형형'], base: { inf: 0.205 }, costMul: 1 },
  mutant: { n: '변이형 바이러스', ic: '🧬', d: '시간이 지나면 스스로 변이해서 능력을 공짜로 얻어요. 대신 업그레이드가 20% 비싸요.', tags: ['자동 변이', '비용 +20%'], base: { inf: 0.195 }, costMul: 1.2, autoMut: true },
  latent: { n: '잠복형 바이러스', ic: '🫥', d: '오랫동안 세계에 들키지 않아요. 초반 전파가 느린 대신 연구가 늦게 시작돼요.', tags: ['은신 +', '초반 전파 -'], base: { inf: 0.18, stealth: 0.5 }, costMul: 1 },
  nova: { n: '특수 바이러스 「노바」', ic: '✴️', d: '항공 이동과 기후 적응이 뛰어난 가상 특수형. 대신 세계가 더 빨리 연구해요.', tags: ['항공 +', '기후 +', '연구 속도 +15%'], base: { inf: 0.2, air: 0.6, cold: 0.2, hot: 0.2, resist: -0.15 }, costMul: 1 },
};

/* ---- 업그레이드 (모두 게임용 가상 능력) ----
   cat: spread(전파) / adapt(적응) / stealth(은신·교란)
   eff: 능력치 증가량, req: 먼저 필요한 업그레이드, cond: 추가 잠금 해제 조건 */
const infCount = () => G ? G.cs.filter(s => s.first >= 0).length : 0;
const UPS = [
  { id: 't1', cat: 'spread', ic: '🌀', n: '확산 파동 I', d: '기본 전파력이 올라가요', c: 3, eff: { inf: 0.03 } },
  { id: 't2', cat: 'spread', ic: '🌀', n: '확산 파동 II', d: '기본 전파력이 더 올라가요', c: 7, req: ['t1'], eff: { inf: 0.035 } },
  { id: 't3', cat: 'spread', ic: '🌀', n: '확산 파동 III', d: '최고 단계 전파력', c: 12, req: ['t2'], eff: { inf: 0.045 }, cond: () => infCount() >= 5, condTxt: '5개국 이상 감염' },
  { id: 'air1', cat: 'spread', ic: '✈️', n: '여행자 표식 I', d: '항공 이동으로 다른 나라에 퍼질 확률 +', c: 4, eff: { air: 0.6 } },
  { id: 'air2', cat: 'spread', ic: '✈️', n: '여행자 표식 II', d: '항공 이동 확산 크게 +', c: 9, req: ['air1'], eff: { air: 0.8 } },
  { id: 'sea1', cat: 'spread', ic: '🚢', n: '항구 표류 I', d: '배를 통해 퍼질 확률 +', c: 4, eff: { sea: 0.6 } },
  { id: 'sea2', cat: 'spread', ic: '🚢', n: '항구 표류 II', d: '배를 통한 확산 크게 +', c: 8, req: ['sea1'], eff: { sea: 0.8 } },
  { id: 'land1', cat: 'spread', ic: '🧭', n: '국경 침투', d: '맞닿은 나라로 퍼질 확률 +, 국경 폐쇄 효과 일부 무시', c: 5, eff: { land: 0.8 } },
  { id: 'cold1', cat: 'adapt', ic: '❄️', n: '추위 적응 I', d: '추운 나라에서 전파력 +', c: 4, eff: { cold: 0.22 } },
  { id: 'cold2', cat: 'adapt', ic: '❄️', n: '추위 적응 II', d: '추운 나라에서 전파력 크게 +', c: 8, req: ['cold1'], eff: { cold: 0.25 } },
  { id: 'hot1', cat: 'adapt', ic: '☀️', n: '더위 적응 I', d: '더운 나라에서 전파력 +', c: 4, eff: { hot: 0.22 } },
  { id: 'hot2', cat: 'adapt', ic: '☀️', n: '더위 적응 II', d: '더운 나라에서 전파력 크게 +', c: 8, req: ['hot1'], eff: { hot: 0.25 } },
  { id: 'city', cat: 'adapt', ic: '🏙️', n: '도시 공명', d: '잘사는 나라(소득 수준 높음)에서 전파력 +', c: 6, req: ['t1'], eff: { rich: 0.3 } },
  { id: 'med1', cat: 'adapt', ic: '🛡️', n: '의료 회피 I', d: '나라들의 의료 대응 효과가 줄어요', c: 6, eff: { medRes: 0.22 } },
  { id: 'med2', cat: 'adapt', ic: '🛡️', n: '의료 회피 II', d: '의료 대응 효과가 크게 줄어요', c: 11, req: ['med1'], eff: { medRes: 0.25 } },
  { id: 'slow1', cat: 'adapt', ic: '⏳', n: '회복 지연 I', d: '감염 상태가 더 오래 유지돼요', c: 5, eff: { slow: 0.18 } },
  { id: 'slow2', cat: 'adapt', ic: '⏳', n: '회복 지연 II', d: '감염 상태가 훨씬 오래 유지돼요', c: 10, req: ['slow1'], eff: { slow: 0.18 } },
  { id: 'st1', cat: 'stealth', ic: '🫥', n: '은신 코드 I', d: '세계가 늦게 알아채고, 나라들의 경보 단계가 천천히 올라가요', c: 4, eff: { stealth: 0.35 } },
  { id: 'st2', cat: 'stealth', ic: '🫥', n: '은신 코드 II', d: '은신 효과 크게 +', c: 8, req: ['st1'], eff: { stealth: 0.35 } },
  { id: 'rd1', cat: 'stealth', ic: '🧩', n: '연구 교란 I', d: '백신 연구 속도 -15%', c: 7, eff: { resist: 0.15 }, cond: () => G.detected, condTxt: '세계가 바이러스를 발견한 뒤' },
  { id: 'rd2', cat: 'stealth', ic: '🧩', n: '연구 교란 II', d: '백신 연구 속도 -15% 추가', c: 12, req: ['rd1'], eff: { resist: 0.15 } },
  { id: 'rd3', cat: 'stealth', ic: '🧩', n: '연구 교란 III', d: '백신 연구 속도 -15% 추가', c: 17, req: ['rd2'], eff: { resist: 0.15 }, cond: () => G.res >= 20, condTxt: '연구 진행률 20% 이상' },
  { id: 'mut', cat: 'stealth', ic: '🎲', n: '변이 가속', d: '가끔 스스로 변이해서 포인트를 얻고 연구를 조금 되돌려요', c: 9, eff: { mut: 1 }, cond: () => infCount() >= 8, condTxt: '8개국 이상 감염' },
];
const UPI = {}; UPS.forEach(u => { UPI[u.id] = u; });
const UP_CATS = [['spread', '🌀 전파'], ['adapt', '🛡️ 적응'], ['stealth', '🫥 은신·교란']];

/* ---- 세계 방역 모드: 플레이어(국제 방역 기구) 행동 ---- */
const ORG_GLOBAL = [
  { id: 'watch', ic: '📡', n: '조기 감시망 가동', d: '아직 세계가 모르는 바이러스를 바로 찾아내 연구를 시작해요', c: 9, ok: () => !G.detected && G.tot && G.tot.cum > 20000, why: () => G.detected ? '이미 발견됨' : '감시할 감염이 아직 적어요 (누적 2만 명 이상)' },
  { id: 'fund', ic: '🧪', n: '연구 지원금', d: '세계 연구 속도 +12% (최대 5번)', c: 6, ok: () => G.detected && !G.vacc && (G.org.fund || 0) < 5, why: () => !G.detected ? '바이러스 발견 후 가능' : G.vacc ? '연구 완료' : '최대치' },
  { id: 'meet', ic: '🤝', n: '국제 협력 회의', d: '협력에 참여하지 않은 6개국이 연구 협력에 참여해요', c: 8, ok: () => G.detected && G.cs.some((s, i) => !s.coop), why: () => '바이러스 발견 후 가능' },
  { id: 'travel', ic: '🛫', n: '세계 여행 경보', d: '감염된 모든 나라의 공항·항구를 30일 동안 막아요', c: 10, ok: () => G.detected, why: () => '바이러스 발견 후 가능' },
  { id: 'camp', ic: '📢', n: '세계 방역 캠페인', d: '감염된 모든 나라의 방역 강도 +20% (30일)', c: 7, ok: () => G.detected, why: () => '바이러스 발견 후 가능' },
  { id: 'vax', ic: '💉', n: '백신 배포 가속', d: '백신 접종 속도 +50% (최대 3번)', c: 8, ok: () => G.vacc && (G.org.vax || 0) < 3, why: () => G.vacc ? '최대치' : '백신 완성 후 가능' },
];
const ORG_LOCAL = [
  { id: 'lmed', ic: '🏥', n: '의료 지원', d: '이 나라의 의료 수준 +10%', c: 4, ok: s => s.med < 0.97, why: () => '의료 수준 최대' },
  { id: 'llock', ic: '🧯', n: '방역 지원', d: '이 나라의 방역 강도 +25% (40일)', c: 5, ok: () => true },
  { id: 'lclose', ic: '🚫', n: '공항·항구 폐쇄 권고', d: '이 나라의 공항과 항구를 40일 동안 막아요', c: 3, ok: (s, c) => AIRPORT.has(c.i) || PORT.has(c.i), why: () => '공항·항구가 없어요' },
  { id: 'lres', ic: '🔬', n: '연구소 지원', d: '이 나라의 연구 투자 +30%', c: 4, ok: s => s.inv < 1, why: () => '투자 최대' },
];

/* ---- 랜덤 이벤트 (선택지에 따라 수치가 달라짐) ---- */
const EVENTS = [
  {
    id: 'coop', ic: '🌐', t: '국제 의료 협력 회의',
    d: c => `${c.ko}에서 세계 여러 나라가 모이는 국제 의료 협력 회의가 열립니다.`,
    spread: [
      { n: '회의장 혼란을 틈타 잠입', d: '포인트 2 사용 · 개최국 즉시 감염, 연구 -2%', c: 2, f: c => { seed(c.i, 3, 'event'); G.res = Math.max(0, G.res - 2); } },
      { n: '조용히 지켜보기', d: '회의가 열려 세계 연구 +2%', f: () => { G.res = Math.min(99.5, G.res + 2); } },
    ],
    protect: [
      { n: '지원금 투입', d: '예산 4 사용 · 6개국 의료 수준 +5%, 연구 +2%', c: 4, f: () => { randCountries(6).forEach(i => { G.cs[i].med = Math.min(C[i].medCap + 0.05, G.cs[i].med + 0.05); }); G.res = Math.min(99.5, G.res + 2); } },
      { n: '참여만 하기', d: '예산 +2', f: () => { G.pts += 2; } },
    ],
  },
  {
    id: 'hosp', ic: '🏥', t: '병원 시설 확충 계획',
    d: c => `${c.ko} 정부가 대규모 병원 시설 확충 계획을 발표했습니다.`,
    spread: [
      { n: '의료 회피 집중', d: '포인트 2 사용 · 이 나라의 의료 확충 효과를 없앰', c: 2, f: () => { } },
      { n: '무시하기', d: '그 나라 의료 수준 +12%', f: c => { G.cs[c.i].med = Math.min(C[c.i].medCap + 0.1, G.cs[c.i].med + 0.12); } },
    ],
    protect: [
      { n: '공동 투자', d: '예산 3 사용 · 그 나라 의료 수준 +18%', c: 3, f: c => { G.cs[c.i].med = Math.min(0.97, G.cs[c.i].med + 0.18); } },
      { n: '자체 진행에 맡기기', d: '그 나라 의료 수준 +6%', f: c => { G.cs[c.i].med = Math.min(C[c.i].medCap, G.cs[c.i].med + 0.06); } },
    ],
  },
  {
    id: 'econ', ic: '📉', t: '세계 경제 위기',
    d: () => '경기 침체로 각국이 방역 예산을 줄이려 합니다.',
    spread: [
      { n: '혼란 활용', d: '포인트 +3 · 모든 나라 방역 강도 -10%', f: () => { G.pts += 3; G.cs.forEach(s => { s.lock = Math.max(0, s.lock - 0.1); }); } },
      { n: '숨죽이기', d: '은신 상태 유지 · 포인트 +1', f: () => { G.pts += 1; } },
    ],
    protect: [
      { n: '긴급 원조 기금', d: '예산 5 사용 · 방역이 유지돼요', c: 5, f: () => { } },
      { n: '방역 완화 허용', d: '예산 +3 · 모든 나라 방역 강도 -15%', f: () => { G.pts += 3; G.cs.forEach(s => { s.lock = Math.max(0, s.lock - 0.15); }); } },
    ],
  },
  {
    id: 'travel', ic: '🧳', t: '여행 수요 급증',
    d: () => '휴가철을 맞아 세계 항공 이용객이 크게 늘었습니다.',
    spread: [
      { n: '여행자 표식 활성화', d: '포인트 2 사용 · 30일 동안 항공 확산 ×2', c: 2, f: () => { addTimer('air', 2, 30); } },
      { n: '흐름에 맡기기', d: '30일 동안 항공 확산 ×1.3', f: () => { addTimer('air', 1.3, 30); } },
    ],
    protect: [
      { n: '여행 경보 발령', d: '예산 3 사용 · 30일 동안 항공 확산 ×0.5', c: 3, f: () => { addTimer('air', 0.5, 30); } },
      { n: '관광 허용', d: '예산 +2 · 30일 동안 항공 확산 ×1.5', f: () => { G.pts += 2; addTimer('air', 1.5, 30); } },
    ],
  },
  {
    id: 'found', ic: '🔬', t: '연구 성과 발견',
    d: c => `${c.ko} 연구팀이 백신 연구에 중요한 단서를 찾았다는 소식입니다.`,
    spread: [
      { n: '연구 교란', d: '포인트 3 사용 · 성과를 무효로 만들어요', c: 3, f: () => { } },
      { n: '그대로 두기', d: '세계 연구 +5%', f: () => { G.res = Math.min(99.5, G.res + 5); } },
    ],
    protect: [
      { n: '추가 투자', d: '예산 4 사용 · 세계 연구 +9%', c: 4, f: () => { G.res = Math.min(99.5, G.res + 9); } },
      { n: '발표만 하기', d: '세계 연구 +4%', f: () => { G.res = Math.min(99.5, G.res + 4); } },
    ],
  },
  {
    id: 'aid', ic: '📦', t: '국제 지원 프로그램',
    d: () => '소득이 낮은 나라들에 물자를 보내는 국제 지원 프로그램이 시작됩니다.',
    spread: [
      { n: '수송로 편승', d: '포인트 2 사용 · 소득 낮은 나라 3곳 감염', c: 2, f: () => { C.filter(c => c.inc <= 2 && G.cs[c.i].first < 0).sort(() => Math.random() - 0.5).slice(0, 3).forEach(c => seed(c.i, 2, 'event')); } },
      { n: '무시하기', d: '소득 낮은 나라 의료 수준 +4%', f: () => { C.forEach(c => { if (c.inc <= 2) G.cs[c.i].med = Math.min(c.medCap, G.cs[c.i].med + 0.04); }); } },
    ],
    protect: [
      { n: '집중 지원', d: '예산 5 사용 · 소득 낮은 나라 의료 수준 +8%', c: 5, f: () => { C.forEach(c => { if (c.inc <= 2) G.cs[c.i].med = Math.min(c.medCap + 0.08, G.cs[c.i].med + 0.08); }); } },
      { n: '예산 확보', d: '예산 +3', f: () => { G.pts += 3; } },
    ],
  },
];

/* ===================== 2. 게임 상태 ===================== */
let G = null;                 // 현재 게임 (저장되는 모든 값)
let S = loadSettings();       // 설정
let SEL = -1;                 // 선택한 나라 번호
let picking = false;          // 시작 나라 고르는 중?
let running = false;          // 게임 화면이 진행 중인지

function loadSettings() {
  const d = { autoBubbles: false, showRoutes: true, newsToast: true, autosave: 5, defSpeed: 1, anim: true };
  try { return Object.assign(d, JSON.parse(localStorage.getItem(SET_KEY) || '{}')); } catch (e) { return d; }
}
function saveSettings() { try { localStorage.setItem(SET_KEY, JSON.stringify(S)); } catch (e) { } }

const DIFF = {
  easy: { n: '쉬움', target: 70, resMul: 0.8, aiMul: 0.8, loss: 70, vInf: 0.9, income: 1.25 },
  normal: { n: '보통', target: 85, resMul: 1, aiMul: 1, loss: 55, vInf: 1, income: 1 },
  hard: { n: '어려움', target: 95, resMul: 1.25, aiMul: 1.2, loss: 40, vInf: 1.1, income: 0.85 },
};

/** 새 게임 만들기 */
function newGame(opt) {
  G = {
    v: 1, mode: opt.mode, diff: opt.diff, vtype: opt.vtype, vname: opt.vname || VTYPES[opt.vtype].n,
    day: 0, pts: opt.mode === 'spread' ? 4 : 10, ups: {}, res: 0, detected: false, detDay: -1, vacc: false, vaccDay: -1,
    over: null, origin: -1, nextEv: 28 + Math.floor(rnd(0, 15)), nextMut: 25, timers: [], org: {}, ai: { pts: 0 },
    stats: { peakI: 0, peakDay: 0, ups: 0, actions: 0, events: 0, bubbles: 0 },
    hist: [], news: [], milestone: 0, cumMark: 0, newToday: [],
    cs: C.map(c => ({
      S: c.N, I: 0, R: 0, cum: 0, vac: 0, first: -1,
      med: clamp(c.medBase + rnd(-0.03, 0.03), 0.08, 0.9), alert: 0, alertT: 0,
      air: true, port: true, border: true, closeT: 0, lock: 0, lockBonus: 0, lockT: 0,
      inv: c.inc >= 4 ? 0.15 : 0.05, coop: false, aid: 0, cleared: false,
    })),
  };
  if (G.mode === 'protect') {
    // 방역 모드: 바이러스는 컴퓨터가 조종, 인구가 많은 나라에서 무작위로 시작
    const cand = C.filter(c => c.pop > 15e6);
    const o = weighted(cand, c => Math.sqrt(c.pop));
    seed(o.i, 5, 'origin');
    G.origin = o.i;
  }
}

function saveGame() {
  if (!G || G.over) return;
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(G)); } catch (e) { toast('저장 공간이 부족해서 저장하지 못했어요'); }
}
function loadGame() {
  try {
    const d = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
    if (!d || d.v !== 1 || !Array.isArray(d.cs) || d.cs.length !== C.length) return null;
    return d;
  } catch (e) { return null; }
}
const hasSave = () => !!loadGame();
function deleteSave() { try { localStorage.removeItem(SAVE_KEY); } catch (e) { } }

/* ===================== 3. 시뮬레이션 ===================== */

/** 현재 바이러스 능력치 = 종류 기본값 + 업그레이드 합계 */
function traits() {
  const t = { inf: 0.2, air: 0, sea: 0, land: 0, cold: 0, hot: 0, rich: 0, medRes: 0, slow: 0, stealth: 0, resist: 0, mut: 0 };
  const b = VTYPES[G.vtype].base;
  for (const k in b) t[k] = (k === 'inf' ? 0 : t[k]) + b[k];
  for (const id in G.ups) { const e = UPI[id] && UPI[id].eff; if (e) for (const k in e) t[k] = (t[k] || 0) + e[k]; }
  if (G.mode === 'protect') t.inf *= DIFF[G.diff].vInf;
  t.stealth = clamp(t.stealth, 0, 1.2); t.medRes = clamp(t.medRes, 0, 0.8); t.slow = clamp(t.slow, 0, 0.5); t.resist = clamp(t.resist, -0.3, 0.6);
  return t;
}
function addTimer(k, v, days) { G.timers.push({ k, v, until: G.day + days }); }
function timerMul(k) { let m = 1; for (const t of G.timers) if (t.k === k && t.until > G.day) m *= t.v; return m; }
function randCountries(n) { return C.map(c => c.i).sort(() => Math.random() - 0.5).slice(0, n); }

/** 나라에 감염자 넣기 (처음 감염이면 뉴스·포인트) */
function seed(i, n, how) {
  const s = G.cs[i]; if (!s || s.S < 1) return false;
  const add = Math.min(s.S, n);
  s.S -= add; s.I += add; s.cum += add;
  if (s.first < 0) {
    s.first = G.day; s.cleared = false;
    (G.newToday || (G.newToday = [])).push(i);
    if (G.mode === 'spread' && how !== 'origin') G.pts += infCount() <= 4 ? 2 : 1;
    if (G.mode === 'protect' && how !== 'origin') G.ai.pts += 0.6;
    markDirty(i);
  }
  return true;
}

let dirtyMap = new Set();
const markDirty = i => dirtyMap.add(i);

/** 하루 진행 (게임의 핵심) */
function stepDay() {
  if (!G || G.over) return;
  G.day++;
  G.newToday = [];
  const T = traits();
  const dif = DIFF[G.diff];
  const gammaBase = 1 / 18 * (1 - T.slow);
  const airMul = timerMul('air');
  const vaxBoost = 1 + 0.5 * (G.org.vax || 0);

  /* --- (1) 나라 안에서의 확산 / 회복 / 백신 접종 --- */
  for (const c of C) {
    const s = G.cs[c.i];
    if (s.lockT && s.lockT <= G.day) { s.lockBonus = 0; s.lockT = 0; }
    if (s.closeT && s.closeT <= G.day) { s.closeT = 0; if (s.alert < 2) { s.air = true; s.port = true; } }
    if (s.I <= 0 && !G.vacc) continue;
    const N = c.N;
    let clim = 1;
    if (c.clim === 'cold') clim = 0.72 + T.cold; else if (c.clim === 'hot') clim = 0.78 + T.hot;
    clim = Math.min(clim, 1.15);
    const rich = c.inc >= 4 ? 0.9 + T.rich : 1;
    const lock = clamp(s.lock + s.lockBonus + (timerMul('camp') > 1 ? 0.2 : 0), 0, 0.85);
    const medEff = s.med * 0.38 * (s.alert >= 1 ? 1 : 0.4) * (1 - T.medRes);
    let beta = T.inf * clim * rich * (1 - lock * 0.7) * (1 - medEff);
    if (G.vacc) beta *= Math.max(0.12, 0.6 - 0.48 * clamp((G.day - G.vaccDay) / 40, 0, 1));
    let ni = s.I > 0 ? beta * s.I * s.S / N : 0;
    ni = Math.min(ni, s.S);
    const gamma = gammaBase * (1 + s.med * 0.5) + (G.vacc ? 0.03 * clamp((G.day - G.vaccDay) / 20, 0, 1) : 0);
    let rec = Math.min(s.I, s.I * gamma);
    // 백신: 연구 완료 후 감염되지 않은 사람을 면역(회복자)으로 옮김
    let vac = 0;
    if (G.vacc) {
      const ramp = clamp((G.day - G.vaccDay) / 30, 0, 1);
      vac = Math.min(s.S - ni, s.S * (0.006 + 0.024 * s.med) * ramp * vaxBoost);
      vac = Math.max(0, vac);
    }
    s.S -= ni + vac; s.I += ni - rec; s.cum += ni; s.vac += vac;
    if (s.I < 0.5 && (G.vacc || s.I < 0.05)) { s.I = 0; }        // 남은 감염이 아주 적으면 사라짐
    s.S = clamp(s.S, 0, N); s.I = clamp(s.I, 0, N - s.S);
    s.R = N - s.S - s.I;                                          // 항상 S+I+R = 인구
    if (s.I === 0 && s.first >= 0 && !s.cleared && s.cum > 10) { s.cleared = true; markDirty(c.i); }
  }

  /* --- (2) 나라 사이의 이동 (육로 · 항공 · 항구) --- */
  const fx = [];
  for (const c of C) {
    const s = G.cs[c.i]; if (s.I < 1) continue;
    const p = s.I / c.N;
    // 육로
    if (c.nb.length) {
      const landF = (1 - Math.exp(-(s.I * 1e-5 + p * 900) * (1 + T.land))) * 0.6;
      for (const id of c.nb) {
        const j = CI[id]; if (j === undefined) continue; const t = G.cs[j];
        if (t.first >= 0 && t.I >= 1) continue;
        const closed = (!s.border || !t.border) ? (T.land > 0 ? 0.55 : 0.12) : 1;
        if (Math.random() < landF * closed) { if (seed(j, 2, 'land') && t.first === G.day) fx.push([c.i, j, 'land']); }
      }
    }
    // 항공
    if (AIRPORT.has(c.i)) {
      const out = s.air ? 1 : 0.15;
      const routes = AIR_ROUTES.get(c.i); const flights = Math.round((1 + c.econ * 4) * out + (out < 1 && Math.random() < 0.5 ? 1 : 0));
      for (let f = 0; f < flights && routes; f++) {
        const j = pick([...routes]); const t = G.cs[j]; const leak = t.air ? 1 : 0.15;
        const carry = leak * clamp(1 - Math.exp(-(s.I * 1.6e-5 * (0.5 + c.econ) + p * 2500) * (1 + T.air) * airMul), 0, 0.9);
        if (Math.random() < carry) { if (t.I < 1 && t.S > 2) { seed(j, 2, 'air'); fx.push([c.i, j, 'air']); } }
        else if (S.showRoutes && s.air && t.air && Math.random() < 0.04) fx.push([c.i, j, 'air0']);
      }
    }
    // 항구
    if (s.port) {
      const routes = SEA_ROUTES.get(c.i);
      if (routes) for (const j of routes) {
        const t = G.cs[j]; if (!t.port || t.first >= 0) continue;
        const carry = clamp(1 - Math.exp(-(s.I * 5e-6 + p * 700) * (1 + T.sea)), 0, 0.5);
        if (Math.random() < carry * 0.35) { seed(j, 2, 'sea'); fx.push([c.i, j, 'sea']); }
      }
    }
    // 기타 이동 (어디로든 아주 가끔)
    if (p > 0.01 && Math.random() < 0.012 * (1 + T.air * 0.3)) {
      const t = weighted(C, x => G.cs[x.i].first < 0 && G.cs[x.i].air ? Math.sqrt(x.pop) : 0);
      if (G.cs[t.i].first < 0 && G.cs[t.i].air) { seed(t.i, 1, 'misc'); fx.push([c.i, t.i, 'air']); }
    }
  }
  fx.forEach(f => spawnFlight(f[0], f[1], f[2]));

  /* --- (3) 세계 합계 --- */
  let I = 0, R = 0, cum = 0, Sus = 0;
  for (const s of G.cs) { I += s.I; R += s.R; cum += s.cum; Sus += s.S; }
  G.tot = { I, R, cum, S: Sus };
  if (I > G.stats.peakI) { G.stats.peakI = I; G.stats.peakDay = G.day; }
  G.hist.push([G.day, Math.round(I), Math.round(R), Math.round(cum)]);

  /* --- (4) 첫 감염 뉴스 --- */
  if (G.newToday.length) {
    const list = G.newToday.filter(i => G.cs[i].first === G.day && i !== G.origin);
    if (list.length === 1 || (list.length && G.day < 3)) list.slice(0, 2).forEach(i => news(`${C[i].ko}에서 첫 감염 사례 확인`, 'bad'));
    else if (list.length > 1) news(`${C[list[0]].ko} 등 ${list.length}개국에서 첫 감염 사례 확인`, 'bad');
  }

  /* --- (5) 세계가 바이러스를 발견했는지 --- */
  if (!G.detected) {
    const thr = 1.5e5 * (1 + T.stealth * 5);
    if (cum > thr || C.some(c => G.cs[c.i].I / c.N > 0.004 * (1 + T.stealth * 3))) {
      G.detected = true; G.detDay = G.day;
      news('정체불명의 새로운 바이러스 확인 — 세계 보건 비상 선언, 백신 연구 시작', 'bad');
      if (G.mode === 'protect') G.pts += 4;
    }
  }

  /* --- (6) AI 국가들의 대응 --- */
  aiCountries(T);

  /* --- (7) 백신 연구 --- */
  research(T);

  /* --- (8) 포인트 / 바이러스 진화 / 방역 기구 예산 --- */
  if (G.mode === 'spread') {
    // 누적 감염이 늘 때마다 포인트
    const mark = Math.floor(Math.log10(Math.max(1, cum)) * 1.5) + Math.floor(cum / WORLD_POP * 25);
    if (mark > G.cumMark) { G.pts += mark - G.cumMark; G.cumMark = mark; }
    if ((T.mut || VTYPES[G.vtype].autoMut) && G.day >= G.nextMut) mutate(T);
  } else {
    G.pts += 0.4 * dif.income * (1 + G.cs.filter(s => s.coop).length / 60);
    aiVirus();
  }
  if (Math.random() < (I > 0 ? 0.32 : 0)) spawnBubble();

  /* --- (9) 이벤트 / 이정표 --- */
  if (G.day >= G.nextEv && !G.over) { G.nextEv = G.day + 30 + Math.floor(rnd(0, 25)); G.pendingEvent = true; }
  checkEnd();
}

/** AI 국가: 경보 단계 → 의료 확충, 여행 제한, 방역 정책, 연구 투자, 협력, 지원 요청 */
function aiCountries(T) {
  if (!G.detected) return;
  const dif = DIFF[G.diff];
  const slow = 1 - T.stealth * 0.45;
  const bigNews = c => c.pop > 40e6 || c.inc >= 5;
  let newsLeft = 3;
  const say = (c, txt, cls) => { if (newsLeft > 0 && bigNews(c)) { news(txt, cls); newsLeft--; } };
  for (const c of C) {
    const s = G.cs[c.i];
    const p = s.I / c.N;
    const nbInf = c.nb.some(id => has(id) && G.cs[CI[id]].I >= 1);
    let target = 0;
    if (s.I >= 1 || nbInf) target = 1;
    if (p > 0.0006 * (1 + T.stealth)) target = 2;
    if (p > 0.012 * (1 + T.stealth)) target = 3;
    if (G.vacc && s.I < 1) target = Math.min(target, 1);
    // 경보 올리기 (은신이 강할수록 느림)
    if (target > s.alert && G.day >= s.alertT && Math.random() < 0.35 * slow * dif.aiMul) {
      s.alert++; s.alertT = G.day + 4;
      if (s.alert === 2) say(c, `${c.ko} 정부, 감염 경보를 '대응' 단계로 올림`, 'info');
      if (s.alert === 3) say(c, `${c.ko}, 국가 비상사태 선포`, 'bad');
    } else if (target < s.alert && G.day >= s.alertT && Math.random() < 0.08) { s.alert--; s.alertT = G.day + 10; }

    // 대응 정책 해제 (백신 이후 진정되면)
    if (G.vacc && s.I < 1) {
      if (s.lock > 0) s.lock = Math.max(0, s.lock - 0.02);
      if (!s.air && !s.closeT && Math.random() < 0.05) { s.air = true; s.port = true; s.border = true; }
    }
    if (s.alert === 0) continue;

    // 하루에 한 번, 확률적으로 행동 하나
    if (Math.random() > 0.05 * s.alert * (0.6 + c.econ * 0.5) * dif.aiMul * slow) continue;
    const opts = [];
    if (s.med < c.medCap) opts.push(['hosp', 3]);
    if (s.alert >= 2 && (s.air || s.port)) opts.push(['travel', 2 + s.alert]);
    if (s.alert >= 3 && s.border && c.nb.length) opts.push(['border', 2]);
    if (s.alert >= 2 && s.lock < [0, 0.2, 0.35, 0.55, 0.7][c.inc - 1] + (s.alert === 3 ? 0.15 : 0)) opts.push(['lock', 3]);
    if (s.inv < 1) opts.push(['inv', 2 + c.econ * 3]);
    if (!s.coop && c.econ > 0.45) opts.push(['coop', 1.5]);
    if (c.inc <= 2 && s.alert >= 3 && !s.aid) opts.push(['aid', 2]);
    if (!opts.length) continue;
    const a = weighted(opts, o => o[1])[0];
    if (a === 'hosp') { s.med = Math.min(c.medCap, s.med + rnd(0.02, 0.05) * (0.6 + c.econ)); say(c, `${c.ko}, 의료 시설 확충`, 'good'); }
    else if (a === 'travel') { if (s.air) { s.air = false; say(c, `${c.ko}, 국제선 항공편 운항 중단`, 'info'); } else { s.port = false; say(c, `${c.ko}, 항구 입항 제한`, 'info'); } }
    else if (a === 'border') { s.border = false; say(c, `${c.ko}, 국경 봉쇄`, 'info'); }
    else if (a === 'lock') { s.lock = Math.min(0.8, s.lock + 0.15); say(c, `${c.ko}, 방역 정책 강화 (모임 제한·원격 근무)`, 'info'); }
    else if (a === 'inv') { s.inv = Math.min(1, s.inv + 0.2); if (c.econ > 0.75) say(c, `${c.ko}, 백신 연구 투자 확대`, 'good'); }
    else if (a === 'coop') { s.coop = true; say(c, `${c.ko}, 국제 연구 협력 발표`, 'good'); }
    else if (a === 'aid') {
      s.aid = G.day; news(`${c.ko}, 국제 사회에 긴급 지원 요청`, 'bad');
      const donor = C.filter(d => G.cs[d.i].coop && d.inc >= 4);
      if (donor.length) { const d = pick(donor); s.med = Math.min(c.medCap + 0.1, s.med + 0.12); news(`${d.ko}, ${c.ko}에 의료진과 장비 긴급 지원`, 'good'); }
    }
  }
}

/** 백신 연구 진행 */
function research(T) {
  if (!G.detected || G.vacc) return;
  let pow = 0, wsum = 0;
  for (const c of C) {
    const s = G.cs[c.i]; const w = c.econ * c.econ * Math.sqrt(c.gdp + 1);
    wsum += w;
    pow += w * (0.15 + 0.85 * s.inv) * (s.coop ? 1.5 : 1) * (s.alert >= 1 ? 1 : 0.5);
  }
  const fund = 1 + 0.12 * (G.org.fund || 0);
  const urg = 1 + clamp(G.tot.I / WORLD_POP * 6, 0, 0.6);
  let rate = 1.5 * (pow / wsum) * (1 - T.resist) * DIFF[G.diff].resMul * fund * urg;
  G.res = Math.min(100, G.res + rate);
  const m = Math.floor(G.res / 10);
  if (m > G.milestone && G.res < 100) { G.milestone = m; news(`세계 백신 연구 진행률 ${m * 10}% 돌파`, m >= 5 ? 'good' : 'info'); }
  if (G.res >= 100) { G.vacc = true; G.vaccDay = G.day; news('백신 완성! 세계 각국에서 접종 시작 — 감염자가 점점 줄어들 전망', 'good'); }
}

/** 변이 (변이형 바이러스 / 변이 가속) */
function mutate(T) {
  G.nextMut = G.day + 25 + Math.floor(rnd(0, 15));
  if (VTYPES[G.vtype].autoMut) {
    const free = UPS.filter(u => !G.ups[u.id] && upReady(u) && u.c <= 9);
    if (free.length) { const u = pick(free); G.ups[u.id] = 1; news(`변이 발생 — 바이러스가 「${u.n}」 능력을 스스로 얻음`, 'bad'); }
  }
  if (T.mut && G.detected && !G.vacc) { G.res = Math.max(0, G.res - 3); G.pts += 2; news('바이러스 변이 확인 — 연구 일부를 다시 해야 하는 상황', 'bad'); }
}

/** 방역 모드: 컴퓨터 바이러스가 스스로 진화 */
function aiVirus() {
  const a = G.ai; a.pts += 0.22 * DIFF[G.diff].aiMul;
  const cand = UPS.filter(u => !G.ups[u.id] && upReady(u) && upCost(u) <= a.pts);
  if (!cand.length || Math.random() > 0.3) return;
  const pref = G.detected ? ['stealth', 'adapt', 'spread'] : ['spread', 'adapt', 'stealth'];
  const u = weighted(cand, x => 4 - pref.indexOf(x.cat));
  a.pts -= upCost(u); G.ups[u.id] = 1;
  if (G.detected) news(`분석 결과 바이러스가 새로운 특성 「${u.n}」을(를) 얻은 것으로 확인`, 'bad');
}

/** 업그레이드 조건/비용 */
function upReady(u) { return (u.req || []).every(r => G.ups[r]) && (!u.cond || u.cond()); }
function upCost(u) { return Math.round(u.c * VTYPES[G.vtype].costMul); }

/** 승리 / 패배 확인 */
function checkEnd() {
  const cumP = G.tot.cum / WORLD_POP * 100;
  if (G.mode === 'spread') {
    if (cumP >= DIFF[G.diff].target) return endGame(true, `확산 점수 ${cumP.toFixed(1)}점 달성! 연구가 끝나기 전에 목표를 넘었어요.`);
    if ((G.tot.I < 1 || (G.vacc && G.tot.I < 20000)) && G.day > 5) return endGame(false, G.vacc ? '백신이 보급되어 바이러스가 사실상 사라졌어요.' : '감염이 모두 사라졌어요. 바이러스가 더 이상 퍼지지 못했어요.');
  } else {
    if (cumP >= DIFF[G.diff].loss) return endGame(false, `누적 감염률이 한계(${DIFF[G.diff].loss}%)를 넘었어요.`);
    if ((G.tot.I < 1 || (G.vacc && G.tot.I < 20000)) && G.day > 5) return endGame(true, G.vacc ? '백신 보급으로 바이러스를 사실상 종식시켰어요!' : '바이러스가 퍼지기 전에 막아냈어요!');
  }
}
function endGame(win, why) {
  G.over = { win, why, day: G.day };
  setSpeed(0);
  deleteSave();
  news(win ? '🏆 게임 종료 — 목표 달성' : '게임 종료', win ? 'good' : 'bad');
  setTimeout(showResult, 400);
}

/* ===================== 4. 지도 ===================== */
const svg = $('map');
const NS = 'http://www.w3.org/2000/svg';
let vp, gCountries, gRoutes, gFx, gBub, cEls = [];
const view = { k: 1, x: 0, y: 0 };
const mk = (tag, attrs, parent) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; };

/** Natural Earth I 투영 (격자선 그리기용, data와 같은 공식) */
function proj(lon, lat) {
  const l = lon * Math.PI / 180, p = lat * Math.PI / 180, p2 = p * p, p4 = p2 * p2;
  const x = l * (0.8707 - 0.131979 * p2 + p4 * (-0.013791 + p4 * (0.003971 * p2 - 0.001529 * p4)));
  const y = p * (1.007226 + p2 * (0.015085 + p4 * (-0.044475 + 0.028874 * p2 - 0.005916 * p4)));
  const xm = Math.PI * 0.8707, ym = (Math.PI / 2) * (1.007226 + (Math.PI / 2) ** 2 * (0.015085 + (Math.PI / 2) ** 4 * (-0.044475 + 0.028874 * (Math.PI / 2) ** 2 - 0.005916 * (Math.PI / 2) ** 4)));
  const sc = 1000 / (2 * xm);
  return [(x + xm) * sc, (ym - y) * sc];
}

function buildMap() {
  if (!MAP_OK) {
    $('mapErr').classList.remove('hidden');
    $('mapErr').innerHTML = '⚠️ 세계 지도 데이터를 불러오지 못했어요.<br><small>virus/data/world.js 파일이 있는지 확인하고 새로고침해 주세요.</small>';
    return;
  }
  svg.setAttribute('viewBox', `0 0 ${WD.w} ${WD.h}`);
  svg.innerHTML = '';
  vp = mk('g', { id: 'vp' }, svg);
  // 바다 외곽 + 격자선
  let outline = ''; for (let lat = -90; lat <= 90; lat += 3) { const [x, y] = proj(-180, lat); outline += (lat === -90 ? 'M' : 'L') + x + ',' + y; } for (let lat = 90; lat >= -90; lat -= 3) { const [x, y] = proj(180, lat); outline += 'L' + x + ',' + y; }
  mk('path', { d: outline + 'Z', fill: '#0b1626', stroke: '#1a2c44', 'stroke-width': 1, 'vector-effect': 'non-scaling-stroke' }, vp);
  let gr = '';
  for (let lon = -150; lon <= 150; lon += 30) { for (let lat = -80; lat <= 80; lat += 4) { const [x, y] = proj(lon, lat); gr += (lat === -80 ? 'M' : 'L') + x.toFixed(1) + ',' + y.toFixed(1); } }
  for (let lat = -60; lat <= 60; lat += 30) { for (let lon = -180; lon <= 180; lon += 6) { const [x, y] = proj(lon, lat); gr += (lon === -180 ? 'M' : 'L') + x.toFixed(1) + ',' + y.toFixed(1); } }
  mk('path', { d: gr, class: 'grat' }, vp);
  if (WD.ata) mk('path', { d: WD.ata, class: 'ata' }, vp);
  gRoutes = mk('g', { id: 'routes' }, vp);
  gCountries = mk('g', { id: 'countries' }, vp);
  cEls = C.map(c => {
    const p = mk('path', { d: c.d, class: 'cty', 'data-i': c.i, fill: 'var(--c0)' }, gCountries);
    const t = mk('title', {}, p); t.textContent = c.ko;
    return p;
  });
  gFx = mk('g', { id: 'fx' }, vp);
  gBub = mk('g', { id: 'bubs' }, vp);
  drawRoutes();
  applyView();
}

/** 정적 이동 경로 (항공: 파랑 실선, 항구: 초록 점선) */
function arc(a, b) {
  const x1 = a.x, y1 = a.y, x2 = b.x, y2 = b.y, mx = (x1 + x2) / 2, my = (y1 + y2) / 2, L = Math.hypot(x2 - x1, y2 - y1);
  return { x1, y1, x2, y2, cx: mx, cy: my - L * 0.18 };
}
function drawRoutes() {
  gRoutes.innerHTML = '';
  if (!S.showRoutes) return;
  const done = new Set();
  const add = (m, cls) => m.forEach((set, a) => set.forEach(b => { const k = a < b ? a + '-' + b : b + '-' + a; if (done.has(cls + k)) return; done.add(cls + k); const r = arc(C[a], C[b]); mk('path', { d: `M${r.x1},${r.y1}Q${r.cx},${r.cy} ${r.x2},${r.y2}`, class: 'route ' + cls }, gRoutes); }));
  add(AIR_ROUTES, 'air'); add(SEA_ROUTES, 'sea');
}

function applyView() {
  if (!vp) return;
  const W = WD.w, H = WD.h;
  view.k = clamp(view.k, 1, 10);
  view.x = clamp(view.x, W - W * view.k, 0); view.y = clamp(view.y, H - H * view.k, 0);
  vp.setAttribute('transform', `translate(${view.x},${view.y}) scale(${view.k})`);
}
function svgPoint(evt) { const pt = svg.createSVGPoint(); pt.x = evt.clientX; pt.y = evt.clientY; return pt.matrixTransform(svg.getScreenCTM().inverse()); }
function zoomAt(f, px, py) {
  const nk = clamp(view.k * f, 1, 10); const r = nk / view.k;
  view.x = px - (px - view.x) * r; view.y = py - (py - view.y) * r; view.k = nk; applyView();
}

/** 지도 조작: 휠 확대, 드래그 이동, 클릭 선택 */
(function mapInput() {
  let drag = null;
  svg.addEventListener('wheel', e => { e.preventDefault(); const p = svgPoint(e); zoomAt(e.deltaY < 0 ? 1.2 : 1 / 1.2, p.x, p.y); }, { passive: false });
  svg.addEventListener('pointerdown', e => { if (e.button !== 0) return; drag = { sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y, moved: false, p0: svgPoint(e) }; });
  window.addEventListener('pointermove', e => {
    if (!drag) return;
    if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 4) { drag.moved = true; svg.classList.add('drag'); }
    if (drag.moved) { const p = svgPoint(e); view.x = drag.vx + (p.x - drag.p0.x); view.y = drag.vy + (p.y - drag.p0.y); drag.p0 = svgPoint(e); drag.vx = view.x; drag.vy = view.y; applyView(); }
  });
  window.addEventListener('pointerup', e => {
    if (!drag) return; const moved = drag.moved; drag = null; svg.classList.remove('drag');
    if (moved) return;
    const b = e.target.closest && e.target.closest('.bub'); if (b) { collectBubble(b); return; }
    const el = e.target.closest && e.target.closest('.cty');
    if (el) clickCountry(+el.getAttribute('data-i'));
  });
  $('zIn').onclick = () => zoomAt(1.4, WD.w / 2, WD.h / 2);
  $('zOut').onclick = () => zoomAt(1 / 1.4, WD.w / 2, WD.h / 2);
  $('zReset').onclick = () => { view.k = 1; view.x = 0; view.y = 0; applyView(); };
  $('tRoutes').onclick = () => { S.showRoutes = !S.showRoutes; saveSettings(); drawRoutes(); $('tRoutes').classList.toggle('on', S.showRoutes); };
})();

function clickCountry(i) {
  if (picking) {
    picking = false; hint('');
    seed(i, 3, 'origin'); G.origin = i;
    news(`${C[i].ko}에서 정체를 알 수 없는 감염 발생`, 'bad');
    selectCountry(i); setSpeed(S.defSpeed); markAllDirty(); updateAll();
    return;
  }
  selectCountry(i);
}
function selectCountry(i) {
  if (SEL >= 0 && cEls[SEL]) cEls[SEL].classList.remove('sel');
  SEL = (SEL === i) ? -1 : i;
  if (SEL >= 0) { cEls[SEL].classList.add('sel'); gCountries.appendChild(cEls[SEL]); }
  renderRight(true);
}

/** 감염 상황에 따른 나라 색 */
function countryColor(i) {
  const s = G.cs[i], c = C[i];
  if (s.first < 0) return 'var(--c0)';
  if (s.I < 1) return s.cleared || G.vacc ? 'var(--c4)' : 'var(--c1)';
  const p = s.I / c.N;
  if (p < 0.005) return 'var(--c1)';
  if (p < 0.05) return 'var(--c2)';
  return 'var(--c3)';
}
const lastCol = [];
function paintMap(all) {
  if (!G || !cEls.length) return;
  for (let i = 0; i < C.length; i++) {
    const col = countryColor(i);
    if (all || lastCol[i] !== col) { cEls[i].setAttribute('fill', col); lastCol[i] = col; }
  }
}
function markAllDirty() { lastCol.length = 0; }

/* ---- 이동 애니메이션 (비행기/배가 선을 따라 움직임) ---- */
const flights = [];
function spawnFlight(a, b, kind) {
  if (!S.anim || !gFx || flights.length > 40) return;
  const r = arc(C[a], C[b]);
  const col = kind === 'air0' ? 'rgba(63,167,255,.5)' : kind === 'sea' ? '#35d07f' : kind === 'land' ? '#ffd23f' : '#ff4a5a';
  const path = mk('path', { d: `M${r.x1},${r.y1}Q${r.cx},${r.cy} ${r.x2},${r.y2}`, class: 'flight', stroke: col, 'stroke-dasharray': '2 3', opacity: 0.0 }, gFx);
  const dot = mk('circle', { r: kind === 'air0' ? 1.2 : 2.2, fill: col }, gFx);
  flights.push({ r, path, dot, t: 0, dur: kind === 'sea' ? 2.6 : kind === 'land' ? 1.2 : 1.8 });
}
function animFlights(dt) {
  for (let k = flights.length - 1; k >= 0; k--) {
    const f = flights[k]; f.t += dt / f.dur;
    const t = Math.min(1, f.t), u = 1 - t, r = f.r;
    const x = u * u * r.x1 + 2 * u * t * r.cx + t * t * r.x2, y = u * u * r.y1 + 2 * u * t * r.cy + t * t * r.y2;
    f.dot.setAttribute('cx', x); f.dot.setAttribute('cy', y);
    f.path.setAttribute('opacity', (t < 0.2 ? t / 0.2 : t > 0.85 ? (1 - t) / 0.15 : 1) * 0.8);
    if (f.t >= 1.15) { f.path.remove(); f.dot.remove(); flights.splice(k, 1); }
  }
}

/* ---- 포인트 방울 (클릭하면 포인트/예산 획득) ---- */
const bubbles = [];
function spawnBubble() {
  if (!gBub || bubbles.length >= 4) return;
  const inf = C.filter(c => G.cs[c.i].I >= 1); if (!inf.length) return;
  const c = weighted(inf, x => Math.sqrt(G.cs[x.i].I));
  const spread = G.mode === 'spread';
  const val = Math.random() < 0.25 ? 2 : 1;
  const g = mk('g', { class: 'bub', transform: `translate(${c.x},${c.y})` }, gBub);
  mk('circle', { r: 7, fill: spread ? '#e0303f' : '#2a7fd8', opacity: 0.92 }, g);
  const t = mk('text', { 'text-anchor': 'middle', y: 3.5, 'font-size': 9, fill: '#fff', 'font-weight': 800 }, g); t.textContent = spread ? '🧬' : '+' + val;
  g.style.transform = 'scale(0)';
  const b = { g, val, born: performance.now(), x: c.x, y: c.y };
  g.__b = b; bubbles.push(b);
}
function collectBubble(el) {
  const b = el.__b; if (!b || b.got) return;
  b.got = true; G.pts += b.val; G.stats.bubbles++;
  el.style.transition = 'opacity .3s'; el.style.opacity = 0;
  setTimeout(() => el.remove(), 320);
  bubbles.splice(bubbles.indexOf(b), 1);
  renderLeft(); renderRight(true);
}
function animBubbles(now) {
  for (const b of [...bubbles]) {
    const age = (now - b.born) / 1000;
    const s = Math.min(1, age * 4) * (1 + Math.sin(age * 5) * 0.06) / view.k * Math.min(view.k, 2.5);
    b.g.setAttribute('transform', `translate(${b.x},${b.y}) scale(${s})`); b.g.style.transform = '';
    if (S.autoBubbles && age > 1.2) collectBubble(b.g);
    else if (age > 9) { b.g.remove(); bubbles.splice(bubbles.indexOf(b), 1); }
  }
}

/* ===================== 5. 화면 갱신 ===================== */
function setText(id, v) { const e = $(id); if (e && e.textContent !== v) e.textContent = v; }

function renderTop() {
  if (!G) return;
  const t = G.tot || { I: 0, R: 0, cum: 0, S: WORLD_POP };
  setText('sPop', fmtK(WORLD_POP));
  setText('sInf', fmtK(t.I));
  setText('sCum', fmtK(t.cum));
  setText('sRec', fmtK(t.R));
  setText('sSus', fmtK(t.S));
  setText('sRes', G.detected ? G.res.toFixed(1) + '%' : '시작 전');
  $('sResBar').style.width = G.res + '%';
  const cp = t.cum / WORLD_POP * 100;
  if (G.mode === 'spread') { setText('sGoalL', '확산 점수 / 목표'); setText('sGoal', cp.toFixed(1) + ' / ' + DIFF[G.diff].target); }
  else { setText('sGoalL', '누적 감염률 / 한계'); setText('sGoal', cp.toFixed(1) + '% / ' + DIFF[G.diff].loss + '%'); }
  setText('dDay', String(G.day));
  const d = new Date(START_DATE.getTime() + G.day * 86400000);
  setText('dDate', `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`);
  setText('vName', G.vname);
}

let upTab = 'spread', orgTab = 'global', leftKey = '';
function renderLeft(force) {
  if (!G) return;
  const T = traits(), vt = VTYPES[G.vtype];
  const key = [Math.floor(G.pts), Object.keys(G.ups).join(','), upTab, G.detected, G.vacc, infCount() >= 5, infCount() >= 8, G.res >= 20, G.mode, JSON.stringify(G.org)].join('|');
  if (!force && key === leftKey) return; leftKey = key;
  $('vIcon').textContent = vt.ic; $('vTitle').textContent = G.vname;
  $('vType').textContent = vt.n + ' · ' + DIFF[G.diff].n + (G.mode === 'protect' ? ' · 컴퓨터가 조종 중' : '');
  const bars = [
    ['전파력', clamp((T.inf - 0.15) / 0.2, 0, 1), '#ff4a5a', (T.inf * 100).toFixed(0)],
    ['항공·항구', clamp((T.air + T.sea) / 2.8, 0, 1), '#3fa7ff', '+' + Math.round((T.air + T.sea) * 50) + '%'],
    ['기후 적응', clamp((T.cold + T.hot) / 1, 0, 1), '#ffd23f', '+' + Math.round((T.cold + T.hot) * 50) + '%'],
    ['은신', clamp(T.stealth / 1.2, 0, 1), '#a77bff', Math.round(T.stealth * 100) + '%'],
    ['연구 교란', clamp(T.resist / 0.6, 0, 1), '#35d07f', Math.round(T.resist * 100) + '%'],
  ];
  $('traits').innerHTML = bars.map(b => `<div class="tr"><span>${b[0]}</span><span class="b"><i style="width:${b[1] * 100}%;background:${b[2]}"></i></span><em>${b[3]}</em></div>`).join('');
  $('pts').textContent = Math.floor(G.pts);
  $('ptsLabel').textContent = G.mode === 'spread' ? '🧬 진화 포인트' : '💰 기구 예산';
  if (G.mode === 'spread') {
    $('upTabs').innerHTML = UP_CATS.map(([k, n]) => `<button class="${upTab === k ? 'on' : ''}" data-ut="${k}">${n}</button>`).join('');
    $('upList').innerHTML = UPS.filter(u => u.cat === upTab).map(u => {
      const own = !!G.ups[u.id], ready = upReady(u), cost = upCost(u), can = !own && ready && G.pts >= cost;
      const why = !ready ? ((u.req || []).filter(r => !G.ups[r]).map(r => UPI[r].n + ' 먼저').concat(u.cond && !u.cond() ? [u.condTxt] : []).join(', ')) : '';
      return `<button class="up ${own ? 'own' : can ? 'can' : ''} ${!own && !ready ? 'lock' : ''}" data-up="${u.id}" ${own || !can ? 'aria-disabled="true"' : ''}>
        <span class="ic">${u.ic}</span><span><b>${u.n}</b><small>${own ? '보유 중' : why ? '🔒 ' + esc(why) : esc(u.d)}</small></span><span class="cost">${own ? '✔' : '🧬' + cost}</span></button>`;
    }).join('');
  } else {
    $('upTabs').innerHTML = `<button class="on">🌍 세계 방역 활동</button>`;
    $('upList').innerHTML = ORG_GLOBAL.map(a => {
      const ok = a.ok(), can = ok && G.pts >= a.c;
      return `<button class="up ${can ? 'can' : ''} ${!ok ? 'lock' : ''}" data-org="${a.id}"><span class="ic">${a.ic}</span><span><b>${a.n}${a.id === 'fund' && G.org.fund ? ` (${G.org.fund}/5)` : a.id === 'vax' && G.org.vax ? ` (${G.org.vax}/3)` : ''}</b><small>${ok ? esc(a.d) : '🔒 ' + esc(a.why())}</small></span><span class="cost">💰${a.c}</span></button>`;
    }).join('') + `<div class="sub">관찰된 바이러스 특성: ${Object.keys(G.ups).length ? Object.keys(G.ups).map(id => UPI[id].ic + UPI[id].n).join(', ') : '아직 없음'}</div>
      <div class="sub">나라를 클릭하면 그 나라만 돕는 지원도 할 수 있어요.</div>`;
  }
}

/** 업그레이드/행동 클릭 */
document.addEventListener('click', e => {
  const t = e.target.closest('[data-ut],[data-up],[data-org],[data-loc],[data-rk]');
  if (!t || !G) return;
  if (t.dataset.ut) { upTab = t.dataset.ut; renderLeft(true); return; }
  if (t.dataset.rk !== undefined) { selectCountry(+t.dataset.rk); return; }
  if (G.over) return;
  if (t.dataset.up) {
    const u = UPI[t.dataset.up]; if (G.ups[u.id]) return;
    if (!upReady(u)) { toast('아직 잠겨 있어요'); return; }
    const cost = upCost(u); if (G.pts < cost) { toast('진화 포인트가 부족해요'); return; }
    G.pts -= cost; G.ups[u.id] = 1; G.stats.ups++;
    news(`바이러스 진화: 「${u.n}」`, 'ev'); renderLeft(true); toast(`${u.ic} ${u.n} 획득!`);
  }
  if (t.dataset.org) doOrg(t.dataset.org);
  if (t.dataset.loc) doLocal(t.dataset.loc);
});

function doOrg(id) {
  const a = ORG_GLOBAL.find(x => x.id === id); if (!a) return;
  if (!a.ok()) { toast(a.why()); return; }
  if (G.pts < a.c) { toast('예산이 부족해요'); return; }
  G.pts -= a.c; G.stats.actions++;
  if (id === 'watch') { G.detected = true; G.detDay = G.day; news('국제 방역 기구, 조기 감시망으로 새로운 바이러스 발견 — 연구 시작', 'good'); }
  if (id === 'fund') { G.org.fund = (G.org.fund || 0) + 1; news(`국제 방역 기구, 백신 연구 지원금 지급 (${G.org.fund}차)`, 'good'); }
  if (id === 'meet') { C.filter(c => !G.cs[c.i].coop).sort((a, b) => b.econ - a.econ).slice(0, 6).forEach(c => { G.cs[c.i].coop = true; }); news('국제 협력 회의 — 6개국이 연구 협력에 새로 참여', 'good'); }
  if (id === 'travel') { C.forEach(c => { const s = G.cs[c.i]; if (s.I >= 1) { s.air = false; s.port = false; s.closeT = G.day + 30; } }); news('세계 여행 경보 발령 — 감염국 공항·항구 30일 폐쇄', 'good'); }
  if (id === 'camp') { addTimer('camp', 1.01, 30); news('세계 방역 캠페인 시작 — 각국 방역 강화', 'good'); }
  if (id === 'vax') { G.org.vax = (G.org.vax || 0) + 1; news('백신 배포 가속 — 물류망 확대', 'good'); }
  renderLeft(true); renderRight(true); toast(a.ic + ' ' + a.n);
}
function doLocal(id) {
  if (SEL < 0) return; const a = ORG_LOCAL.find(x => x.id === id), s = G.cs[SEL], c = C[SEL];
  if (!a.ok(s, c)) { toast(a.why()); return; }
  if (G.pts < a.c) { toast('예산이 부족해요'); return; }
  G.pts -= a.c; G.stats.actions++;
  if (id === 'lmed') s.med = Math.min(0.97, s.med + 0.1);
  if (id === 'llock') { s.lockBonus = 0.25; s.lockT = G.day + 40; }
  if (id === 'lclose') { s.air = false; s.port = false; s.closeT = G.day + 40; }
  if (id === 'lres') s.inv = Math.min(1, s.inv + 0.3);
  news(`국제 방역 기구, ${c.ko}에 ${a.n}`, 'good');
  renderLeft(true); renderRight(true); toast(a.ic + ' ' + c.ko + ' ' + a.n);
}

let rightAt = 0;
function renderRight(force) {
  if (!G) return;
  const now = performance.now(); if (!force && now - rightAt < 300) return; rightAt = now;
  const box = $('countryCard');
  if (SEL < 0) {
    // 선택한 나라가 없으면 감염률 순위
    const list = C.filter(c => G.cs[c.i].first >= 0).sort((a, b) => G.cs[b.i].I / b.N - G.cs[a.i].I / a.N).slice(0, 14);
    const infN = infCount();
    box.innerHTML = `<div class="cname"><div><b>🌍 세계 현황</b><small>나라를 클릭하면 자세한 정보가 나와요</small></div></div>
      <div class="kv"><span>감염된 나라</span><b>${infN} / ${C.length}개국</b><span>공항 닫은 나라</span><b>${G.cs.filter(s => !s.air).length}개국</b><span>연구 협력 국가</span><b>${G.cs.filter(s => s.coop).length}개국</b><span>최고 감염자</span><b>${fmtK(G.stats.peakI)} (DAY ${G.stats.peakDay})</b></div>
      <div class="h4">국가별 감염률 (현재 감염자 비율)</div>
      <div class="rank">${list.length ? list.map((c, k) => { const p = G.cs[c.i].I / c.N * 100; return `<button class="rk" data-rk="${c.i}"><span>${k + 1}</span><span>${esc(c.ko)}</span><b style="text-align:right">${fmtP(p)}</b><span class="bb"><i style="width:${clamp(p * 4, 1, 100)}%"></i></span></button>`; }).join('') : '<small style="color:var(--dim)">아직 감염된 나라가 없어요</small>'}</div>`;
    return;
  }
  const c = C[SEL], s = G.cs[SEL];
  const iP = s.I / c.N * 100, rP = s.R / c.N * 100, sP = s.S / c.N * 100;
  const al = ['안정', '주의', '대응', '비상'][s.alert];
  const lockP = Math.round(clamp(s.lock + s.lockBonus, 0, 0.85) * 100);
  box.innerHTML = `<div class="cname"><div><b>${esc(c.ko)}</b><small>${esc(c.en)} · ${esc(c.sub || c.cont)}</small></div><span class="alert a${s.alert}">경보: ${al}</span></div>
    <div class="big3"><div><small>감염자</small><b style="color:var(--red)">${fmtK(s.I)}</b></div><div><small>회복·면역</small><b style="color:var(--blue)">${fmtK(s.R)}</b></div><div><small>미감염</small><b>${fmtK(s.S)}</b></div></div>
    <div class="stack"><i style="width:${iP}%;background:var(--red)"></i><i style="width:${rP}%;background:var(--blue)"></i><i style="width:${sP}%;background:#2a3446"></i></div>
    <div class="kv">
      <span>인구</span><b>${fmtN(c.N)}명</b>
      <span>감염률</span><b>${fmtP(iP)}</b>
      <span>누적 감염</span><b>${fmtN(s.cum)}명</b>
      <span>첫 감염</span><b>${s.first >= 0 ? 'DAY ' + s.first : '-'}</b>
      <span>경제력 (GDP)</span><b>${'★'.repeat(c.inc)}${'☆'.repeat(5 - c.inc)}</b>
      <span>기후</span><b>${{ cold: '❄️ 추움', hot: '☀️ 더움', mild: '🌤️ 온화' }[c.clim]}</b>
    </div>
    <div class="h4">의료 수준 ${Math.round(s.med * 100)}%</div><div class="meter"><i style="width:${s.med * 100}%"></i></div>
    <div class="h4">방역 강도 ${lockP}%</div><div class="meter"><i style="width:${lockP}%;background:var(--orange)"></i></div>
    <div class="h4">백신 연구 투자 ${Math.round(s.inv * 100)}%</div><div class="meter"><i style="width:${s.inv * 100}%;background:var(--green)"></i></div>
    <div class="h4">정책</div>
    <div class="pol">
      ${AIRPORT.has(c.i) ? `<span class="${s.air ? '' : 'on'}">✈ 공항 ${s.air ? '운영' : '폐쇄'}</span>` : '<span>✈ 큰 공항 없음</span>'}
      ${PORT.has(c.i) || SEA_ROUTES.has(c.i) ? `<span class="${s.port ? '' : 'on'}">🚢 항구 ${s.port ? '운영' : '폐쇄'}</span>` : ''}
      ${c.nb.length ? `<span class="${s.border ? '' : 'on'}">🧱 국경 ${s.border ? '개방' : '봉쇄'}</span>` : ''}
      <span class="${s.coop ? 'ok' : ''}">🤝 연구 협력 ${s.coop ? '참여' : '미참여'}</span>
      ${s.aid ? '<span class="on">🆘 지원 요청</span>' : ''}
    </div>
    <div class="h4">이웃 나라 (육로)</div><small style="color:var(--dim)">${c.nb.length ? c.nb.filter(has).map(id => C[CI[id]].ko).join(', ') : '없음 (섬나라)'}</small>
    ${G.mode === 'protect' ? `<div class="h4">국제 방역 기구 지원 (예산 ${Math.floor(G.pts)})</div><div class="act">${ORG_LOCAL.map(a => { const ok = a.ok(s, c); return `<button class="btn" data-loc="${a.id}" ${!ok || G.pts < a.c || G.over ? 'disabled' : ''}><span>${a.ic} ${a.n}<small>${ok ? a.d : a.why()}</small></span><span class="cost">💰${a.c}</span></button>`; }).join('')}</div>` : ''}
    <div class="row" style="justify-content:flex-start"><button class="gbtn" data-rk="${SEL}">✕ 선택 해제</button></div>`;
}

/* ---- 그래프 (캔버스에 직접 그림) ---- */
function drawChart(cv, hist) {
  const dpr = window.devicePixelRatio || 1, w = cv.clientWidth || 280, h = cv.clientHeight || 120;
  if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
  g.fillStyle = '#0b0f15'; g.fillRect(0, 0, w, h);
  if (!hist.length) { g.fillStyle = '#4a5466'; g.font = '12px sans-serif'; g.fillText('게임이 진행되면 그래프가 그려져요', 10, h / 2); return; }
  const max = Math.max(1, ...hist.map(r => Math.max(r[1], r[2], r[3])));
  const days = hist[hist.length - 1][0] || 1, L = 30, B = 14;
  g.strokeStyle = '#1c2533'; g.lineWidth = 1; g.font = '9px sans-serif'; g.fillStyle = '#5a6578';
  for (let k = 0; k <= 4; k++) { const y = (h - B) - (h - B - 6) * k / 4; g.beginPath(); g.moveTo(L, y); g.lineTo(w, y); g.stroke(); g.fillText(fmtK(max * k / 4), 2, y + 3); }
  g.fillText('DAY ' + days, w - 46, h - 3); g.fillText('0', L, h - 3);
  const line = (idx, col, fill) => {
    g.beginPath();
    const step = Math.max(1, Math.floor(hist.length / (w - L)));
    for (let k = 0; k < hist.length; k += step) { const r = hist[k]; const x = L + (w - L - 2) * (r[0] / days), y = (h - B) - (h - B - 6) * (r[idx] / max); k === 0 ? g.moveTo(x, y) : g.lineTo(x, y); }
    const r = hist[hist.length - 1]; g.lineTo(L + (w - L - 2), (h - B) - (h - B - 6) * (r[idx] / max));
    g.strokeStyle = col; g.lineWidth = 1.8; g.stroke();
    if (fill) { g.lineTo(w - 2, h - B); g.lineTo(L, h - B); g.closePath(); g.fillStyle = fill; g.fill(); }
  };
  line(3, '#ff8a3a'); line(2, '#3fa7ff', 'rgba(63,167,255,.08)'); line(1, '#ff4a5a', 'rgba(255,74,90,.12)');
}

/* ---- 뉴스 ---- */
function news(text, cls) {
  if (!G) return;
  G.news.unshift([G.day, text, cls || 'info']);
  if (G.news.length > 300) G.news.length = 300;
  showTicker();
  if (S.newsToast && (cls === 'bad' || cls === 'good') && running && /첫 감염|비상|백신 완성|발견|연구 협력|진행률/.test(text) && G.day > 0) toast('📰 ' + text);
}
let tickAt = 0, tickTimer = null;
function showTicker() {
  if (!G || !G.news.length) { $('newsTicker').innerHTML = '<span style="color:var(--dim)">아직 뉴스가 없어요</span>'; return; }
  const now = performance.now();
  if (now - tickAt < 700) { if (!tickTimer) tickTimer = setTimeout(() => { tickTimer = null; showTicker(); }, 700 - (now - tickAt)); return; }
  tickAt = now;
  const n = G.news[0];
  $('newsTicker').innerHTML = `<span class="new"><span class="nd">DAY ${n[0]}</span>${esc(n[1])}</span>`;
}
$('newsMore').onclick = () => {
  if (!G) return;
  const prev = speed; setSpeed(0);
  modal(`<h2>📰 세계 뉴스</h2><p>게임 속에서 실제로 일어난 일들이에요 (최근 순).</p><div class="newslog">${G.news.map(n => `<div class="n-${n[2]}"><span class="nd">DAY ${n[0]}</span>${esc(n[1])}</div>`).join('') || '<div>아직 뉴스가 없어요</div>'}</div><div class="row"><button class="pbtn" data-close>닫기</button></div>`, () => setSpeed(prev));
};

function toast(t) { const e = $('toast'); e.textContent = t; e.classList.add('on'); clearTimeout(e._t); e._t = setTimeout(() => e.classList.remove('on'), 2200); }
function hint(t) { const e = $('hint'); e.textContent = t; e.classList.toggle('on', !!t); }

function updateAll() { renderTop(); renderLeft(true); renderRight(true); paintMap(true); drawChart($('chart'), G ? G.hist : []); showTicker(); }

/* ===================== 6. 메뉴 / 팝업 ===================== */
let modalClose = null;
function modal(html, onClose) {
  $('modal').innerHTML = html; $('overlay').classList.remove('hidden'); modalClose = onClose || null;
}
function closeModal() { $('overlay').classList.add('hidden'); const f = modalClose; modalClose = null; if (f) f(); }
$('overlay').addEventListener('click', e => { if (e.target.closest('[data-close]')) closeModal(); });

/** 시작 화면 */
function showTitle() {
  setSpeed(0); running = false;
  const sv = loadGame();
  modal(`<div class="title"><div class="big">VIRUS SIMULATOR</div><small>전략 확산 시뮬레이션</small></div>
    <p style="text-align:center">가상의 바이러스가 세계로 퍼지는 과정을 시뮬레이션하는 전략 게임이에요.<br>모든 바이러스 특성은 게임용 가상 능력이에요.</p>
    <div class="menu">
      <button class="mbtn pri" id="mContinue" ${sv ? '' : 'disabled'}>▶ 이어하기 <small>${sv ? `DAY ${sv.day} · ${sv.mode === 'spread' ? '확산' : '방역'} 모드` : '저장된 게임 없음'}</small></button>
      <button class="mbtn" id="mNew">🆕 새 게임</button>
      <button class="mbtn" id="mSet">⚙️ 설정</button>
      <button class="mbtn" id="mDel" ${sv ? '' : 'disabled'}>🗑️ 저장된 게임 삭제</button>
      <a class="mbtn" href="../" style="text-decoration:none;color:inherit">🏠 게임 허브로</a>
    </div>`);
  $('mContinue').onclick = () => { const d = loadGame(); if (!d) return; G = d; startPlaying(false); };
  $('mNew').onclick = () => newGameFlow();
  $('mSet').onclick = () => showSettings(showTitle);
  $('mDel').onclick = () => confirmBox('저장된 게임을 삭제할까요? 되돌릴 수 없어요.', () => { deleteSave(); toast('저장된 게임을 삭제했어요'); showTitle(); }, showTitle);
}

function confirmBox(msg, yes, no) {
  modal(`<h2>확인</h2><p>${esc(msg)}</p><div class="row"><button class="gbtn" id="cNo">취소</button><button class="pbtn" id="cYes">확인</button></div>`);
  $('cNo').onclick = () => { closeModal(); if (no) no(); };
  $('cYes').onclick = () => { closeModal(); yes(); };
}

/** 새 게임: 모드 → 바이러스 → 이름·난이도 */
function newGameFlow() {
  const o = { mode: 'spread', vtype: 'basic', diff: 'normal', vname: '' };
  const step1 = () => {
    modal(`<h2>🆕 새 게임 — 모드 선택</h2><p>어떤 입장에서 플레이할지 골라 주세요.</p>
      <div class="grid2">
        <button class="pick ${o.mode === 'spread' ? 'on' : ''}" data-m="spread"><div class="pi">🦠</div><b>확산 시뮬레이션 모드</b><small>내가 바이러스가 되어 능력을 키워요. 백신 연구가 끝나기 전에 목표 확산 점수(누적 감염률)를 넘으면 승리!</small></button>
        <button class="pick ${o.mode === 'protect' ? 'on' : ''}" data-m="protect"><div class="pi">🛡️</div><b>세계 방역 모드</b><small>국제 방역 기구를 운영해요. 의료 자원을 나눠 주고 연구를 지원해서, 누적 감염률이 한계를 넘기 전에 바이러스를 없애면 승리!</small></button>
      </div>
      <div class="row"><button class="gbtn" id="b0">← 뒤로</button><button class="pbtn" id="n1">다음 →</button></div>`);
    document.querySelectorAll('[data-m]').forEach(b => b.onclick = () => { o.mode = b.dataset.m; step1(); });
    $('b0').onclick = showTitle; $('n1').onclick = step2;
  };
  const step2 = () => {
    modal(`<h2>${o.mode === 'spread' ? '🧬 바이러스 선택' : '🧬 상대할 바이러스 선택'}</h2><p>${o.mode === 'spread' ? '종류마다 게임 특성이 달라요.' : '컴퓨터가 이 바이러스를 조종하며 스스로 진화해요.'}</p>
      <div class="grid4">${Object.entries(VTYPES).map(([k, v]) => `<button class="pick ${o.vtype === k ? 'on' : ''}" data-v="${k}"><div class="pi">${v.ic}</div><b>${v.n}</b><small>${v.d}</small>${v.tags.map(t => `<span class="tg">${t}</span>`).join('')}</button>`).join('')}</div>
      <div class="row"><button class="gbtn" id="b1">← 뒤로</button><button class="pbtn" id="n2">다음 →</button></div>`);
    document.querySelectorAll('[data-v]').forEach(b => b.onclick = () => { o.vtype = b.dataset.v; step2(); });
    $('b1').onclick = step1; $('n2').onclick = step3;
  };
  const step3 = () => {
    modal(`<h2>⚙️ 이름과 난이도</h2>
      <h3>바이러스 이름</h3><input class="inp" id="vn" maxlength="20" placeholder="${VTYPES[o.vtype].n}" value="${esc(o.vname)}">
      <h3>난이도</h3><div class="seg">${Object.entries(DIFF).map(([k, d]) => `<button data-d="${k}" class="${o.diff === k ? 'on' : ''}">${d.n}</button>`).join('')}</div>
      <p style="margin-top:10px">${o.mode === 'spread' ? `목표 확산 점수: <b style="color:var(--yellow)">${DIFF[o.diff].target}점</b> (세계 인구 중 누적 감염 비율) · 연구 속도 ×${DIFF[o.diff].resMul}` : `누적 감염률 한계: <b style="color:var(--yellow)">${DIFF[o.diff].loss}%</b> · 예산 수입 ×${DIFF[o.diff].income}`}</p>
      <div class="row"><button class="gbtn" id="b2">← 뒤로</button><button class="pbtn" id="go">게임 시작 🚀</button></div>`);
    document.querySelectorAll('[data-d]').forEach(b => b.onclick = () => { o.vname = $('vn').value.trim(); o.diff = b.dataset.d; step3(); });
    $('b2').onclick = () => { o.vname = $('vn').value.trim(); step2(); };
    $('go').onclick = () => { o.vname = $('vn').value.trim().slice(0, 20); newGame(o); startPlaying(true); };
  };
  step1();
}

function startPlaying(fresh) {
  closeModal(); running = true; SEL = -1; markAllDirty(); leftKey = '';
  bubbles.forEach(b => b.g.remove()); bubbles.length = 0; flights.forEach(f => { f.path.remove(); f.dot.remove(); }); flights.length = 0;
  if (!G.tot) { let I = 0, R = 0, cum = 0, Sv = 0; for (const s of G.cs) { I += s.I; R += s.R; cum += s.cum; Sv += s.S; } G.tot = { I, R, cum, S: Sv }; }
  upTab = 'spread'; updateAll(); $('tRoutes').classList.toggle('on', S.showRoutes);
  if (fresh && G.mode === 'spread') { picking = true; hint('🖱️ 감염을 시작할 나라를 지도에서 클릭하세요'); setSpeed(0); }
  else if (fresh) { news('국제 방역 기구 출범 — 세계를 지켜라!', 'good'); news(`${C[G.origin].ko} 어딘가에서 이상 징후 (아직 정체불명)`, 'info'); setSpeed(S.defSpeed); }
  else { setSpeed(0); toast('저장된 게임을 불러왔어요 (일시정지 상태)'); }
}

function showSettings(back) {
  const prev = speed; setSpeed(0);
  const row = (k, n, d) => `<label>${n}<small>${d}</small></label><button class="sw ${S[k] ? 'on' : ''}" data-sw="${k}"></button>`;
  modal(`<h2>⚙️ 설정</h2><div class="set">
    ${row('autoBubbles', '포인트 방울 자동 수집', '지도에 뜨는 방울을 클릭하지 않아도 자동으로 모아요')}
    ${row('showRoutes', '이동 경로 표시', '항공(파랑)·항구(초록) 노선과 평상시 비행을 보여줘요')}
    ${row('anim', '이동 애니메이션', '나라 사이로 퍼질 때 움직이는 점을 보여줘요')}
    ${row('newsToast', '중요 뉴스 알림', '중요한 뉴스가 나오면 화면 아래에 잠깐 띄워요')}
    <label>자동 저장 간격<small>게임 날짜 기준</small></label><div class="seg" style="min-width:200px">${[0, 5, 10, 30].map(v => `<button data-as="${v}" class="${S.autosave === v ? 'on' : ''}">${v ? v + '일' : '끔'}</button>`).join('')}</div>
    <label>시작 속도<small>게임을 시작할 때 속도</small></label><div class="seg" style="min-width:200px">${[1, 3, 10].map(v => `<button data-ds="${v}" class="${S.defSpeed === v ? 'on' : ''}">${v}×</button>`).join('')}</div>
  </div><div class="row"><button class="pbtn" id="sDone">완료</button></div>`);
  document.querySelectorAll('[data-sw]').forEach(b => b.onclick = () => { const k = b.dataset.sw; S[k] = !S[k]; b.classList.toggle('on', S[k]); saveSettings(); if (k === 'showRoutes' && gRoutes) { drawRoutes(); $('tRoutes').classList.toggle('on', S.showRoutes); } });
  document.querySelectorAll('[data-as]').forEach(b => b.onclick = () => { S.autosave = +b.dataset.as; saveSettings(); document.querySelectorAll('[data-as]').forEach(x => x.classList.toggle('on', x === b)); });
  document.querySelectorAll('[data-ds]').forEach(b => b.onclick = () => { S.defSpeed = +b.dataset.ds; saveSettings(); document.querySelectorAll('[data-ds]').forEach(x => x.classList.toggle('on', x === b)); });
  $('sDone').onclick = () => { closeModal(); if (back) back(); else setSpeed(prev); };
}

/** 게임 중 메뉴 */
$('btnMenu').onclick = () => {
  if (!G || !running) { showTitle(); return; }
  const prev = speed; setSpeed(0);
  modal(`<h2>☰ 메뉴</h2><div class="menu">
    <button class="mbtn pri" data-close>▶ 계속하기</button>
    <button class="mbtn" id="gSave" ${G.over ? 'disabled' : ''}>💾 지금 저장</button>
    <button class="mbtn" id="gSet">⚙️ 설정</button>
    <button class="mbtn" id="gNew">🆕 새 게임</button>
    <button class="mbtn" id="gTitle">🏁 시작 화면으로 (자동 저장)</button>
    <a class="mbtn" href="../" style="text-decoration:none;color:inherit">🏠 게임 허브로</a></div>`, () => setSpeed(prev));
  $('gSave').onclick = () => { saveGame(); toast('💾 저장했어요'); };
  $('gSet').onclick = () => { modalClose = null; showSettings(() => setSpeed(prev)); };
  $('gNew').onclick = () => { modalClose = null; confirmBox('지금 게임을 저장하고 새 게임을 시작할까요?', () => { saveGame(); newGameFlow(); }, () => setSpeed(prev)); };
  $('gTitle').onclick = () => { modalClose = null; saveGame(); showTitle(); };
};
$('btnFull').onclick = () => { if (!document.fullscreenElement) document.documentElement.requestFullscreen && document.documentElement.requestFullscreen().catch(() => toast('이 브라우저에서는 전체 화면을 쓸 수 없어요')); else document.exitFullscreen(); };

/** 랜덤 이벤트 팝업 */
function showEvent() {
  G.pendingEvent = false;
  const ev = pick(EVENTS); const host = weighted(C, c => c.econ * Math.sqrt(c.pop)); const ch = ev[G.mode];
  const prev = speed || S.defSpeed; setSpeed(0); G.stats.events++;
  modal(`<h2>${ev.ic} ${ev.t}</h2><p>DAY ${G.day} · ${esc(ev.d(host))}</p>
    <div class="choice">${ch.map((o, k) => `<button data-ch="${k}" ${(o.c || 0) > G.pts ? 'disabled' : ''}><b>${o.n}</b><small>${o.d}${(o.c || 0) > G.pts ? ' (부족)' : ''}</small></button>`).join('')}</div>`);
  document.querySelectorAll('[data-ch]').forEach(b => b.onclick = () => {
    const o = ch[+b.dataset.ch]; if ((o.c || 0) > G.pts) return;
    G.pts -= o.c || 0; o.f(host);
    news(`${ev.t}: ${o.n}`, 'ev'); closeModal(); renderLeft(true); setSpeed(prev);
  });
}

/** 게임 결과 (최종 통계) */
function showResult() {
  const o = G.over, t = G.tot, cp = t.cum / WORLD_POP * 100;
  modal(`<div class="result"><div class="rt ${o.win ? 'win' : 'lose'}">${o.win ? '🏆 승리!' : '💀 패배'}</div><p>${esc(o.why)}</p></div>
    <div class="fs">
      <div><small>진행 일수</small><b>${o.day}일</b></div>
      <div><small>누적 감염자</small><b>${fmtK(t.cum)}</b></div>
      <div><small>누적 감염률</small><b>${cp.toFixed(1)}%</b></div>
      <div><small>최고 동시 감염자</small><b>${fmtK(G.stats.peakI)}</b></div>
      <div><small>감염된 나라</small><b>${infCount()}개국</b></div>
      <div><small>백신 연구</small><b>${G.res.toFixed(0)}%</b></div>
      <div><small>${G.mode === 'spread' ? '획득한 능력' : '방역 활동'}</small><b>${G.mode === 'spread' ? G.stats.ups : G.stats.actions}번</b></div>
      <div><small>랜덤 이벤트</small><b>${G.stats.events}번</b></div>
      <div><small>모은 방울</small><b>${G.stats.bubbles}개</b></div>
    </div>
    <canvas id="finalChart"></canvas>
    <div class="row"><button class="gbtn" id="rMap">지도 보기</button><button class="gbtn" id="rTitle">시작 화면</button><button class="pbtn" id="rNew">새 게임</button></div>`);
  drawChart($('finalChart'), G.hist);
  $('rMap').onclick = () => closeModal();
  $('rTitle').onclick = showTitle; $('rNew').onclick = newGameFlow;
}

/* ===================== 7. 게임 루프 ===================== */
let speed = 0, acc = 0, lastT = performance.now(), sinceSave = 0, uiAt = 0;
function setSpeed(v) {
  if (picking && v > 0) { toast('먼저 시작할 나라를 클릭하세요'); v = 0; }
  if (G && G.over && v > 0) v = 0;
  speed = v;
  document.querySelectorAll('#speed button').forEach(b => b.classList.toggle('on', +b.dataset.sp === v));
}
document.querySelectorAll('#speed button').forEach(b => b.onclick = () => { if (!G || !running) return; if (!$('overlay').classList.contains('hidden')) return; setSpeed(+b.dataset.sp); });
window.addEventListener('keydown', e => {
  if (!G || !running || e.target.tagName === 'INPUT' || !$('overlay').classList.contains('hidden')) return;
  if (e.code === 'Space') { e.preventDefault(); setSpeed(speed ? 0 : (S.defSpeed || 1)); }
  if (e.key === '1') setSpeed(1); if (e.key === '2') setSpeed(3); if (e.key === '3') setSpeed(10);
});

function frame(now) {
  const dt = Math.min(0.1, (now - lastT) / 1000); lastT = now;
  if (G && running && speed > 0 && !G.over) {
    acc += dt * 1000;
    const msPerDay = 900 / speed;
    let steps = 0;
    while (acc >= msPerDay && steps < 4) { acc -= msPerDay; stepDay(); steps++; sinceSave++; if (G.over || G.pendingEvent) break; }
    if (acc > msPerDay * 4) acc = 0;
    if (steps) { paintMap(false); drawChart($('chart'), G.hist); }
    if (S.autosave && sinceSave >= S.autosave) { sinceSave = 0; saveGame(); }
    if (G.pendingEvent && !G.over) showEvent();
  }
  if (G && running && now - uiAt > 150) { uiAt = now; renderTop(); renderLeft(false); renderRight(false); }
  animFlights(dt); animBubbles(now);
  requestAnimationFrame(frame);
}

window.addEventListener('pagehide', () => { if (running) saveGame(); });
document.addEventListener('visibilitychange', () => { if (document.hidden && running) saveGame(); });

// 시작!
buildMap();
showTicker();
if (MAP_OK) showTitle();
requestAnimationFrame(frame);

// 테스트용 (개발자 확인용 도구)
window.__vsim = { get G() { return G; }, C, UPS, ORG_GLOBAL, ORG_LOCAL, upReady, upCost, doOrg, EVENTS, stepDay, newGame, startPlaying, clickCountry, setSpeed, traits, WORLD_POP, saveGame, loadGame };

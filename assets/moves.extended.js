const MOVES_EXT = {

  'ginga': {
    longDesc: 'The ginga is the heartbeat of capoeira — a continuous, swaying movement that serves as both the default state and the engine of deception. From the ginga, all attacks and defenses flow naturally. The back-and-forth weight shift lowers the center of gravity and creates unpredictable angles that make the practitioner hard to read.',
    aliases: [],
    variations: ['Ginga Aberta', 'Ginga Fechada', 'Ginga Angola'],
    targets: [],
    videos: [],
    p3d: {
      head:      [58, 134, 4],  headR: 9,
      shoulderL: [42, 118, 6], shoulderR: [68, 118, -6],
      hipL:      [48,  74, 5], hipR:      [66,  74, -5],
      elbowL:    [36, 106, 8], elbowR:    [74, 106, -8],
      handL:     [32,  92, 9], handR:     [72,  94, -9],
      kneeL:     [44,  44, 8], kneeR:     [72,  44, -8],
      footL:     [38,  10, 10], footR:    [78,  10, -10],
    }
  },

  'bencao': {
    longDesc: 'The bênção (blessing) is a powerful linear front kick driven from the hip. The knee chambers high before the leg extends to push rather than cut — it is a push-kick designed to create distance or drive an opponent backward. At full extension the foot is flexed, heel leading, targeting the center of mass.',
    aliases: ['Pisão', 'Chapa de Frente'],
    variations: ['Bênção de Costas', 'Bênção Alta', 'Bênção Baixa'],
    targets: [
      { area: 'Torso', desc: 'Primary target — solar plexus or sternum. Collapses the posture and breaks balance.' },
      { area: 'Head', desc: 'High variation aimed at the chin or jaw when the opponent is bent forward.' },
    ],
    videos: [],
    p3d: {
      head:      [54, 120,  2],  headR: 9,
      shoulderL: [40, 104,  8], shoulderR: [66, 106, -4],
      hipL:      [46,  72,  6], hipR:      [62,  72, -4],
      elbowL:    [32,  92, 10], elbowR:    [70,  90, -6],
      handL:     [26,  80, 12], handR:     [68,  78, -8],
      kneeL:     [76,  86,  0], footL:     [92,  64,  0],
      kneeR:     [58,  44, -6], footR:     [54,  10, -8],
    }
  },

  'meia-lua-de-frente': {
    longDesc: 'Meia-lua de frente (front half-moon) traces a horizontal crescent from outside to inside in front of the body. The leg swings in a wide arc at hip-to-head height, using the momentum of the hip rotation rather than raw muscular force. The arc is initiated from the back foot and concludes as the leg crosses the body centerline.',
    aliases: ['Meia Lua de Frente'],
    variations: ['Meia-lua de Compasso', 'Meia-lua de Costas'],
    targets: [
      { area: 'Head', desc: 'Temple, jaw, or ear — the instep or outer edge of the foot connects as the arc peaks.' },
      { area: 'Torso', desc: 'Lower arc variation targeting the floating ribs.' },
    ],
    videos: [],
    p3d: {
      head:      [58, 130,  6],  headR: 9,
      shoulderL: [42, 114,  8], shoulderR: [70, 116, -4],
      hipL:      [48,  76,  6], hipR:      [64,  76, -4],
      elbowL:    [34, 100, 10], elbowR:    [76,  96, -6],
      handL:     [30,  88, 12], handR:     [78,  84, -8],
      kneeL:     [14,  96, -2], footL:     [-4,  84, -4],
      kneeR:     [56,  42, -6], footR:     [52,  10, -8],
    }
  },

  'armada': {
    longDesc: 'The armada is a spinning roundhouse where the practitioner rotates 360 degrees and delivers a heel or sole strike on the follow-through. The spin is initiated by turning the back foot outward and driving the hip; the kicking leg stays loose until the rotation commits it into the target zone. The key danger is the second half of the spin, which is invisible to the opponent.',
    aliases: ['Armada com Martelo'],
    variations: ['Armada Dupla', 'Armada Pulada', 'Armada Cruzada'],
    targets: [
      { area: 'Head', desc: 'Temple, jaw, or back of the head — the heel connects at the tail of the rotation.' },
      { area: 'Neck/Shoulder', desc: 'Follow-through variation when the opponent ducks the primary arc.' },
    ],
    videos: [],
    p3d: {
      head:      [42, 128, -8],  headR: 9,
      shoulderL: [28, 112, -4], shoulderR: [54, 114,  4],
      hipL:      [36,  78, -2], hipR:      [54,  78,  6],
      elbowL:    [18,  96, -6], elbowR:    [64,  96,  8],
      handL:     [10,  84, -8], handR:     [72,  84, 10],
      kneeL:     [62,  92,  2], footL:     [88, 110,  0],
      kneeR:     [46,  44,  4], footR:     [50,  10,  6],
    }
  },

  'au': {
    longDesc: 'The aú (cartwheel) is the foundational acrobatic inversion of capoeira. Both hands contact the ground in sequence as the legs arc overhead, keeping the body in constant motion. In jogo it functions as an escape — moving laterally out of the line of attack while maintaining a threat position. The aú aberto (open cartwheel) and aú fechado (closed, one-armed) offer different risk and speed profiles.',
    aliases: ['Aú', 'Au Aberto'],
    variations: ['Aú Fechado', 'Aú de Cabeça', 'Aú Batido', 'Aú Cortado'],
    targets: [],
    videos: [],
    p3d: {
      head:      [78,  90, -2],  headR: 9,
      shoulderL: [56,  82, 10], shoulderR: [90,  86, -8],
      hipL:      [50,  36, 12], hipR:      [72,  40, -10],
      elbowL:    [46,  62, 14], elbowR:    [96,  68, -12],
      handL:     [48,  38, 16], handR:     [108, 46, -14],
      kneeL:     [30,  30, 18], footL:     [10,  14, 20],
      kneeR:     [86, 118, -6], footR:     [94, 146, -8],
    }
  },

};
// Stub entries for all other moves — populated as 3D data becomes available
['esquiva-lateral','esquiva-baixa','negativa','role','cocorinha',
 'bencao','armada-cruzada','martelo','martelo-do-chao','martelo-rodado',
 'chapa','chapa-de-costas','chapa-giratoria','queixada','ponteira',
 'rasteira','banda','tesoura','balao','amortecer','cabecada'].forEach(function(s){
  if(!MOVES_EXT[s]) MOVES_EXT[s] = { longDesc:'', aliases:[], variations:[], targets:[], videos:[], p3d:null };
});

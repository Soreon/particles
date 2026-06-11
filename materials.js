const materials = new Map();
const SAND = { name: 'sand', density: 10, friction: 1, type: 'solid' };
const WATER = { name: 'water', density: 5, friction: 0, type: 'liquid', fluidity: 0.8 };
const OIL = { name: 'oil', density: 6, friction: 0, type: 'liquid', fluidity: 0.25, flammability: 170 };
const ALCOOL = { name: 'alcool', density: 4, friction: 0, type: 'liquid', fluidity: 1.0, flammability: 255 };
// Pierre : immobile et indéplaçable — pour construire bassins, barrages, murs.
const STONE = { name: 'stone', density: 255, type: 'static' };
// Bois : solide de construction — immobile comme la pierre, mais il BRÛLE.
const WOOD = { name: 'wood', density: 255, type: 'static', flammability: 140 };
// Feu : brûle sur place (les flammes montantes sont des langues spawnées),
// embrase bois/huile/alcool, éteint par l'eau (en la vaporisant).
const FIRE = { name: 'fire', density: 0, type: 'fire' };
// Fumée : gaz qui monte, ondule et se dissipe.
const SMOKE = { name: 'smoke', density: 1, type: 'gas' };
// Vapeur : gaz né de l'eau au feu — monte puis se condense en pluie.
const STEAM = { name: 'steam', density: 1, type: 'gas' };


materials.set(0, { name: 'void', density: 0 });

materials.set(100, { color: '#afa971', ...SAND });
materials.set(101, { color: '#c5bf87', ...SAND });
materials.set(102, { color: '#dbd59e', ...SAND });
materials.set(103, { color: '#e3dda5', ...SAND });
materials.set(104, { color: '#beb781', ...SAND });
materials.set(105, { color: '#d2cb94', ...SAND });
materials.set(106, { color: '#cfc892', ...SAND });
materials.set(107, { color: '#d6cf98', ...SAND });
materials.set(108, { color: '#d6cf98', ...SAND });
materials.set(109, { color: '#c9c08f', ...SAND });

materials.set(110, { color: '#1f55ff', ...WATER });
materials.set(111, { color: '#2055fd', ...WATER });
materials.set(112, { color: '#255afe', ...WATER });
materials.set(113, { color: '#2a5dfd', ...WATER });
materials.set(114, { color: '#2d60fd', ...WATER });
materials.set(115, { color: '#3264fd', ...WATER });
materials.set(116, { color: '#3d6dff', ...WATER });
materials.set(117, { color: '#3e6efe', ...WATER });
materials.set(118, { color: '#3d70f9', ...WATER });
materials.set(119, { color: '#3b6ff9', ...WATER });

materials.set(120, { color: '#2a211b', ...OIL });
materials.set(121, { color: '#48362b', ...OIL });
materials.set(122, { color: '#3a2c23', ...OIL });
materials.set(123, { color: '#594437', ...OIL });
materials.set(124, { color: '#372a22', ...OIL });
materials.set(125, { color: '#554236', ...OIL });
materials.set(126, { color: '#403229', ...OIL });
materials.set(127, { color: '#775f50', ...OIL });
materials.set(128, { color: '#614e42', ...OIL });
materials.set(129, { color: '#413026', ...OIL });

materials.set(130, { color: '#211b2a', ...ALCOOL });
materials.set(131, { color: '#362b48', ...ALCOOL });
materials.set(132, { color: '#2c233a', ...ALCOOL });
materials.set(133, { color: '#443759', ...ALCOOL });
materials.set(134, { color: '#2a2237', ...ALCOOL });
materials.set(135, { color: '#423655', ...ALCOOL });
materials.set(136, { color: '#322940', ...ALCOOL });
materials.set(137, { color: '#5f5077', ...ALCOOL });
materials.set(138, { color: '#4e4261', ...ALCOOL });
materials.set(139, { color: '#302641', ...ALCOOL });

materials.set(140, { color: '#4e4e52', ...STONE });
materials.set(141, { color: '#56565a', ...STONE });
materials.set(142, { color: '#5e5e63', ...STONE });
materials.set(143, { color: '#525257', ...STONE });
materials.set(144, { color: '#64646a', ...STONE });
materials.set(145, { color: '#595960', ...STONE });
materials.set(146, { color: '#505054', ...STONE });
materials.set(147, { color: '#616167', ...STONE });
materials.set(148, { color: '#54545b', ...STONE });
materials.set(149, { color: '#5c5c61', ...STONE });

materials.set(150, { color: '#5d4024', ...WOOD });
materials.set(151, { color: '#6b4a2b', ...WOOD });
materials.set(152, { color: '#74512f', ...WOOD });
materials.set(153, { color: '#634428', ...WOOD });
materials.set(154, { color: '#7a5733', ...WOOD });
materials.set(155, { color: '#6f4d2d', ...WOOD });
materials.set(156, { color: '#684726', ...WOOD });
materials.set(157, { color: '#775431', ...WOOD });
materials.set(158, { color: '#60422a', ...WOOD });
materials.set(159, { color: '#715031', ...WOOD });

materials.set(160, { color: '#ff4800', ...FIRE });
materials.set(161, { color: '#ff6a00', ...FIRE });
materials.set(162, { color: '#ff8c00', ...FIRE });
materials.set(163, { color: '#ffae00', ...FIRE });
materials.set(164, { color: '#ffd000', ...FIRE });
materials.set(165, { color: '#ff5500', ...FIRE });
materials.set(166, { color: '#ff7700', ...FIRE });
materials.set(167, { color: '#ff9900', ...FIRE });
materials.set(168, { color: '#ffbb00', ...FIRE });
materials.set(169, { color: '#ff6000', ...FIRE });

materials.set(170, { color: '#26262a', ...SMOKE });
materials.set(171, { color: '#2c2c31', ...SMOKE });
materials.set(172, { color: '#323238', ...SMOKE });
materials.set(173, { color: '#38383f', ...SMOKE });
materials.set(174, { color: '#2a2a2e', ...SMOKE });
materials.set(175, { color: '#303036', ...SMOKE });
materials.set(176, { color: '#36363c', ...SMOKE });
materials.set(177, { color: '#3c3c42', ...SMOKE });
materials.set(178, { color: '#28282c', ...SMOKE });
materials.set(179, { color: '#343439', ...SMOKE });

materials.set(180, { color: '#b8c4cc', ...STEAM });
materials.set(181, { color: '#c2ccd4', ...STEAM });
materials.set(182, { color: '#ccd6dc', ...STEAM });
materials.set(183, { color: '#d6e0e6', ...STEAM });
materials.set(184, { color: '#bcc8d0', ...STEAM });
materials.set(185, { color: '#c8d2d8', ...STEAM });
materials.set(186, { color: '#d2dce2', ...STEAM });
materials.set(187, { color: '#d8e2e8', ...STEAM });
materials.set(188, { color: '#c0cad2', ...STEAM });
materials.set(189, { color: '#ced8de', ...STEAM });


export default materials;

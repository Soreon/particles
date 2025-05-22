const materials = new Map();
const SAND = { name: 'sand', density: 10, friction: 1, type: 'solid' };
const WATER = { name: 'water', density: 5, friction: 0, type: 'liquid' };
const OIL = { name: 'oil', density: 6, friction: 0, type: 'liquid' };
const ALCOOL = { name: 'alcool', density: 4, friction: 0, type: 'liquid' };


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


export default materials;

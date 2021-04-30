const materials = new Map();
const SAND = { name: 'sand', density: 10, friction: 1 };
const WATER = { name: 'water', density: 5, friction: 0 };

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

export default materials;

export default class State {
  width;

  height;

  materials;

  constructor(_width, _height) {
    this.width = _width;
    this.height = _height;
    this.materials = new Uint16Array(this.width * this.height);
  }
}

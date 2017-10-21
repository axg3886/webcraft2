/* eslint-env browser */
// All of these functions are in the global scope

// returns mouse position in local coordinate system of element
window.getMouse = (e) => {
  const mouse = {}; // make an object
  mouse.x = e.pageX - e.target.offsetLeft;
  mouse.y = e.pageY - e.target.offsetTop;
  return mouse;
};

window.getRandom = (min, max) => Math.random() * (max - min) + min;

window.nextInt = (i) => Math.floor(Math.random() * i);

window.makeColor = (red, green, blue, alpha) =>
  `rgba(${red},${green},${blue}, ${alpha})`;

// Function Name: getRandomColor()
// returns a random color of alpha 1.0
// http://paulirish.com/2009/random-hex-color-code-snippets/
window.getRandomColor = () => {
  const red = Math.round(Math.random() * 200 + 55);
  const green = Math.round(Math.random() * 200 + 55);
  const blue = Math.round(Math.random() * 200 + 55);
  const color = `rgb(${red},${green},${blue})`;
	// OR	if you want to change alpha
	// var color='rgba('+red+','+green+','+blue+',0.50)'; // 0.50
  return color;
};

window.getRandomUnitVector = () => {
  let x = window.getRandom(-1, 1);
  let y = window.getRandom(-1, 1);
  let length = Math.sqrt(x * x + y * y);
  if (length === 0) { // very unlikely
    x = 1; // point right
    y = 0;
    length = 1;
  } else {
    x /= length;
    y /= length;
  }

  return { x, y };
};

window.simplePreload = (imageArray) => {
	// loads images all at once
  for (let i = 0; i < imageArray.length; i++) {
    const img = new Image();
    img.src = imageArray[i];
  }
};


window.loadImagesWithCallback = (sources, callback) => {
  const imageObjects = [];
  const numImages = sources.length;
  let numLoadedImages = 0;
  const func = () => {
    numLoadedImages++;
    // console.log("loaded image at '" + this.src + "'")
    if (numLoadedImages >= numImages) {
      callback(imageObjects); // send the images back
    }
  };

  for (let i = 0; i < numImages; i++) {
    imageObjects[i] = new Image();
    imageObjects[i].onload = func;
    imageObjects[i].src = sources[i];
  }
};

/*
Function Name: clamp(val, min, max)
Author: Web - various sources
Return Value: the constrained value
Description: returns a value that is
constrained between min and max (inclusive)
*/
window.clamp = (val, min, max) => Math.max(min, Math.min(max, val));


 // FULL SCREEN MODE
window.requestFullscreen = (element) => {
  if (element.requestFullscreen) {
    element.requestFullscreen();
  } else if (element.mozRequestFullscreen) {
    element.mozRequestFullscreen();
  } else if (element.mozRequestFullScreen) { // camel-cased 'S' was changed to 's' in spec
    element.mozRequestFullScreen();
  } else if (element.webkitRequestFullscreen) {
    element.webkitRequestFullscreen();
  }
	// .. and do nothing if the method is not supported
};
var birdX = 80;
var birdY = 300;
var birdWidth = 30;
var birdHeight = 30;
var birdSpeed = 0;
var gravity = 0.2;
var lift = 0.45;
var spaceDown = false;

var pipes = [];
var pipeWidth = 60;
var pipeGap = 180;
var pipeSpeed = 3;
var frameCount = 0;

var HIGH_SCORE_KEY = "flappy.highScore";
var SCORES_KEY = "flappy.scores";
var MAX_SAVED_SCORES = 20;

function loadHighScore() {
  try {
    var saved = parseInt(localStorage.getItem(HIGH_SCORE_KEY), 10);
    return isNaN(saved) ? 0 : saved;
  } catch (e) {
    return 0;
  }
}

function saveScore(finalPoints) {
  if (finalPoints > highScore) {
    highScore = finalPoints;
  }

  try {
    var scores = JSON.parse(localStorage.getItem(SCORES_KEY)) || [];
    scores.push(finalPoints);
    localStorage.setItem(SCORES_KEY, JSON.stringify(scores.slice(-MAX_SAVED_SCORES)));
    localStorage.setItem(HIGH_SCORE_KEY, String(highScore));
  } catch (e) {
    // storage unavailable or corrupted; the game still works without persistence
  }
}

var points = 0;
var highScore = loadHighScore();
var gameOver = false;
var started = false;
var canvas = document.getElementById("game");
var ctx = canvas.getContext("2d");
var gameInterval = null;

function startGame() {
  birdY = 300;
  birdSpeed = 0;
  pipes = [];
  frameCount = 0;
  points = 0;
  gameOver = false;
  started = true;

  if (gameInterval === null) {
    gameInterval = setInterval(gameLoop, 16);
  }
}

document.addEventListener("keydown", function (e) {
  if (e.code == "Space") {
    e.preventDefault();
    spaceDown = true;
    if (gameOver == true) {
      startGame();
    }
  }
});

document.addEventListener("keyup", function (e) {
  if (e.code == "Space") {
    spaceDown = false;
  }
});

canvas.addEventListener("mousedown", function () {
  spaceDown = true;
  if (gameOver == true) {
    startGame();
  }
});

canvas.addEventListener("mouseup", function () {
  spaceDown = false;
});

function gameLoop() {
  update();
  draw();
}

function update() {
  if (gameOver == true) {
    return;
  }

  if (spaceDown == true) {
    birdSpeed = birdSpeed - lift;
  }

  birdSpeed = birdSpeed + gravity;

  if (birdSpeed > 6) {
    birdSpeed = 6;
  }
  if (birdSpeed < -4) {
    birdSpeed = -4;
  }

  birdY = birdY + birdSpeed;

  frameCount = frameCount + 1;
  if (frameCount % 90 == 0) {
    var topHeight = Math.floor(Math.random() * (canvas.height - pipeGap - 100)) + 50;
    pipes.push({
      x: canvas.width,
      top: topHeight,
      bottom: topHeight + pipeGap,
      passed: false,
    });
  }

  for (var i = pipes.length - 1; i >= 0; i--) {
    pipes[i].x = pipes[i].x - pipeSpeed;
    if (pipes[i].x + pipeWidth < 0) {
      pipes.splice(i, 1);
    }
  }

  for (var i = 0; i < pipes.length; i++) {
    if (pipes[i].passed == false && pipes[i].x + pipeWidth < birdX) {
      pipes[i].passed = true;
      points = points + 1;
    }
  }

  for (var i = 0; i < pipes.length; i++) {
    if (checkCollision(pipes[i]) == true) {
      gameOver = true;
    }
  }

  if (birdY + birdHeight > canvas.height || birdY < 0) {
    gameOver = true;
  }

  if (gameOver == true) {
    saveScore(points);
    clearInterval(gameInterval);
    gameInterval = null;
  }
}

function checkCollision(pipe) {
  if (birdX + birdWidth > pipe.x && birdX < pipe.x + pipeWidth) {
    if (birdY < pipe.top || birdY + birdHeight > pipe.bottom) {
      return true;
    }
  }
  return false;
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "#70c5ce";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "green";
  ctx.strokeStyle = "darkgreen";
  ctx.lineWidth = 3;
  for (var i = 0; i < pipes.length; i++) {
    ctx.fillRect(pipes[i].x, 0, pipeWidth, pipes[i].top);
    ctx.fillRect(pipes[i].x, pipes[i].bottom, pipeWidth, canvas.height - pipes[i].bottom);
    ctx.strokeRect(pipes[i].x, 0, pipeWidth, pipes[i].top);
    ctx.strokeRect(pipes[i].x, pipes[i].bottom, pipeWidth, canvas.height - pipes[i].bottom);
  }

  ctx.fillStyle = "yellow";
  ctx.fillRect(birdX, birdY, birdWidth, birdHeight);

  if (gameOver == true) {
    ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "white";
    ctx.font = "30px Arial";
    ctx.textAlign = "center";
    ctx.fillText("Game Over", canvas.width / 2, canvas.height / 2);
    ctx.font = "16px Arial";
    ctx.fillText("Press space to restart", canvas.width / 2, canvas.height / 2 + 30);
  }

  ctx.fillStyle = "white";
  ctx.font = "16px Arial";
  ctx.textAlign = "left";
  ctx.fillText("Score: " + points, 10, 24);
  ctx.textAlign = "right";
  ctx.fillText(highScore + ": High-score", canvas.width - 10, 24);
}

startGame();

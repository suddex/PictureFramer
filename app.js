import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

let originalImage = null;
let userImageTexture = null;

// Get all DOM elements
const imageInput = document.getElementById('image-input');
const widthSlider = document.getElementById('width-slider');
const widthNumber = document.getElementById('width-number');
const heightSlider = document.getElementById('height-slider');
const heightNumber = document.getElementById('height-number');
const depthSlider = document.getElementById('depth-slider');
const depthNumber = document.getElementById('depth-number');
const exportBtn = document.getElementById('export-btn');
const borderCheckbox = document.getElementById('border-checkbox');
const borderCmSlider = document.getElementById('border-cm-slider');
const borderCmNumber = document.getElementById('border-cm-number');
const frameColorInput = document.getElementById('frame-color-input'); // New: Frame color input

// --- Event Listeners with Synchronization ---

imageInput.addEventListener('change', handleImageUpload);
exportBtn.addEventListener('click', exportToGLB);

// Sync functions for width
widthSlider.addEventListener('input', () => syncInputs(widthSlider, widthNumber, true));
widthNumber.addEventListener('input', () => syncInputs(widthNumber, widthSlider, true));

// Sync functions for height
heightSlider.addEventListener('input', () => syncInputs(heightSlider, heightNumber, true));
heightNumber.addEventListener('input', () => syncInputs(heightNumber, heightSlider, true));

// Sync functions for depth
depthSlider.addEventListener('input', () => syncInputs(depthSlider, depthNumber));
depthNumber.addEventListener('input', () => syncInputs(depthNumber, depthSlider));

// Sync functions for border
borderCheckbox.addEventListener('change', handleBorderChange);
borderCmSlider.addEventListener('input', () => syncInputs(borderCmSlider, borderCmNumber, true));
borderCmNumber.addEventListener('input', () => syncInputs(borderCmNumber, borderCmSlider, true));

// Event listener for frame color input - now also triggers texture update
frameColorInput.addEventListener('input', updateTexture);

/**
 * Generic function to sync a source input with a target input.
 * `shouldUpdateTexture` is true for dimensions that affect the texture.
 */
function syncInputs(source, target, shouldUpdateTexture = false) {
    target.value = source.value;
    if (shouldUpdateTexture) {
        updateBorderSliderConstraints();
        // handleBorderChange calls updateTexture internally, ensuring texture updates
        handleBorderChange(); 
    }
}

function handleImageUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
            originalImage = img;
            updateBorderSliderConstraints();
            updateTexture(); // Call updateTexture to apply image and frame color
            exportBtn.disabled = false;
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

function handleBorderChange() {
    const isEnabled = borderCheckbox.checked;
    borderCmSlider.disabled = !isEnabled;
    borderCmNumber.disabled = !isEnabled;
    if (originalImage) {
        updateTexture(); // Call updateTexture to re-render with/without border
    }
}

function updateBorderSliderConstraints() {
    const widthInCm = parseFloat(widthNumber.value);
    const heightInCm = parseFloat(heightNumber.value);
    const maxAllowedBorder = Math.floor(Math.min(widthInCm, heightInCm) / 2 * 10) / 10; // Allow one decimal place
    
    borderCmSlider.max = maxAllowedBorder;
    borderCmNumber.max = maxAllowedBorder;

    if (parseFloat(borderCmSlider.value) > maxAllowedBorder) {
        borderCmSlider.value = maxAllowedBorder;
        borderCmNumber.value = maxAllowedBorder;
    }
}

/**
 * Finds the bounding box of the non-transparent content in an image.
 * This effectively "crops" away surrounding transparent pixels.
 * @param {HTMLImageElement} img The image to analyze.
 * @returns {{x: number, y: number, width: number, height: number}} The bounding box.
 */
function findOpaqueContentBounds(img) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = img.width;
    canvas.height = img.height;
    ctx.drawImage(img, 0, 0);

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;

    let minX = canvas.width;
    let minY = canvas.height;
    let maxX = 0;
    let maxY = 0;

    let hasOpaquePixels = false;

    // Scan from edges inward to find the first opaque pixel (optimization)
    // Find minY
    for (let y = 0; y < canvas.height; y++) {
        for (let x = 0; x < canvas.width; x++) {
            if (data[(y * canvas.width + x) * 4 + 3] > 0) { // Check alpha channel
                minY = y;
                hasOpaquePixels = true;
                y = canvas.height; // Break outer loop
                break;
            }
        }
    }
    if (!hasOpaquePixels) { // Entirely transparent image, return original dimensions
        return { x: 0, y: 0, width: img.width, height: img.height };
    }

    // Find maxY
    for (let y = canvas.height - 1; y >= minY; y--) {
        for (let x = 0; x < canvas.width; x++) {
            if (data[(y * canvas.width + x) * 4 + 3] > 0) {
                maxY = y;
                y = minY - 1; // Break outer loop
                break;
            }
        }
    }

    // Find minX
    for (let x = 0; x < canvas.width; x++) {
        for (let y = minY; y <= maxY; y++) {
            if (data[(y * canvas.width + x) * 4 + 3] > 0) {
                minX = x;
                x = canvas.width; // Break outer loop
                break;
            }
        }
    }

    // Find maxX
    for (let x = canvas.width - 1; x >= minX; x--) {
        for (let y = minY; y <= maxY; y++) {
            if (data[(y * canvas.width + x) * 4 + 3] > 0) {
                maxX = x;
                x = minX - 1; // Break outer loop
                break;
            }
        }
    }
    
    const contentWidth = maxX - minX + 1;
    const contentHeight = maxY - minY + 1;

    return { x: minX, y: minY, width: contentWidth, height: contentHeight };
}


function updateTexture() {
    if (!originalImage) return;

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    
    const frameColor = frameColorInput.value; // Get the chosen frame color

    const frameWidthCm = parseFloat(widthNumber.value);
    const frameHeightCm = parseFloat(heightNumber.value);
    // Get border size, 0 if checkbox is not checked
    const borderCm = borderCheckbox.checked ? parseFloat(borderCmNumber.value) : 0;

    // Determine the canvas pixel resolution based on the overall frame dimensions.
    // We aim for a max dimension to ensure good quality without excessive memory.
    const MAX_TEXTURE_SIZE = 2048; 
    let canvasPixelWidth;
    let canvasPixelHeight;

    const aspectRatioFrame = frameWidthCm / frameHeightCm;
    if (aspectRatioFrame >= 1) { // Wider or square frame, cap width at MAX_TEXTURE_SIZE
        canvasPixelWidth = MAX_TEXTURE_SIZE;
        canvasPixelHeight = MAX_TEXTURE_SIZE / aspectRatioFrame;
    } else { // Taller frame, cap height at MAX_TEXTURE_SIZE
        canvasPixelHeight = MAX_TEXTURE_SIZE;
        canvasPixelWidth = MAX_TEXTURE_SIZE * aspectRatioFrame;
    }

    // Set canvas dimensions, rounded to nearest pixel
    canvas.width = Math.round(canvasPixelWidth);
    canvas.height = Math.round(canvasPixelHeight);

    // 1. Fill the entire canvas with the chosen frame color.
    // This serves as the background for both borders and any internal transparency.
    ctx.fillStyle = frameColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // 2. Find the opaque content bounds of the original image.
    // This gives us the rectangle of the image that isn't fully transparent.
    const contentBounds = findOpaqueContentBounds(originalImage);

    // Calculate the pixel dimensions of the inner area where the image will be drawn.
    // This area accounts for the border thickness.
    const borderPixelsX = (borderCm / frameWidthCm) * canvas.width;
    const borderPixelsY = (borderCm / frameHeightCm) * canvas.height;
    
    const innerCanvasX = borderPixelsX;
    const innerCanvasY = borderPixelsY;
    const innerCanvasWidth = canvas.width - (borderPixelsX * 2);
    const innerCanvasHeight = canvas.height - (borderPixelsY * 2);

    // 3. Draw the cropped opaque content of the original image into the inner canvas area.
    // The 9-argument drawImage scales the source (contentBounds) to the destination (innerCanvas area).
    if (innerCanvasWidth > 0 && innerCanvasHeight > 0 && contentBounds.width > 0 && contentBounds.height > 0) {
        ctx.drawImage(
            originalImage, 
            contentBounds.x, contentBounds.y, contentBounds.width, contentBounds.height, // Source rectangle (cropped content)
            innerCanvasX, innerCanvasY, innerCanvasWidth, innerCanvasHeight             // Destination rectangle on canvas
        );
    } 
    // If innerCanvas dimensions are non-positive or image has no opaque content,
    // the canvas remains fully filled with the frame color, which is the desired behavior.

    // Dispose of previous texture to prevent memory leaks
    if (userImageTexture) {
        userImageTexture.dispose();
    }
    
    // Create new THREE.CanvasTexture from the prepared canvas
    userImageTexture = new THREE.CanvasTexture(canvas);
    userImageTexture.colorSpace = THREE.SRGBColorSpace; // Ensure correct color interpretation
}

function exportToGLB() {
    if (!userImageTexture) {
        alert("Please select an image first!");
        return;
    }
    const scene = new THREE.Scene();

    const widthInCm = parseFloat(widthNumber.value);
    const heightInCm = parseFloat(heightNumber.value);
    const depthInCm = parseFloat(depthNumber.value);

    const widthInMeters = widthInCm / 100.0;
    const heightInMeters = heightInCm / 100.0;
    const depthInMeters = depthInCm / 100.0;

    const geometry = new THREE.BoxGeometry(widthInMeters, heightInMeters, depthInMeters);
    
    // Get the frame color from the input for the 3D material
    const frameColorHex = frameColorInput.value;
    const frameColor = new THREE.Color(frameColorHex); // Convert hex string to THREE.Color

    // Material for the frame sides (uses the chosen frame color)
    const plainMaterial = new THREE.MeshStandardMaterial({ color: frameColor, metalness: 0.1, roughness: 0.8 });
    // Material for the front face (uses the generated canvas texture)
    const textureMaterial = new THREE.MeshStandardMaterial({ map: userImageTexture });

    // Apply materials: [right, left, top, bottom, front, back]
    const materials = [plainMaterial, plainMaterial, plainMaterial, plainMaterial, textureMaterial, plainMaterial];
    const cube = new THREE.Mesh(geometry, materials);
    scene.add(cube);

    const exporter = new GLTFExporter();
    const options = { binary: true };

    exporter.parse(scene, (glb) => {
        saveArrayBuffer(glb, 'photo-frame.glb');
    }, (error) => {
        console.error('An error occurred during GLB export:', error);
    }, options);
}

function saveArrayBuffer(buffer, fileName) {
    const blob = new Blob([buffer], { type: 'application/octet-stream' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(link.href);
}
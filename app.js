import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

let originalImage = null;
let userImageTexture = null;

// Get all DOM elements, including the new number inputs
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
// NEW: Get the frame color input
const frameColorInput = document.getElementById('frame-color-input');

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

// NEW: Event listener for frame color input
frameColorInput.addEventListener('input', updateTexture);

/**
 * NEW: Generic function to sync a source input with a target input.
 */
function syncInputs(source, target, shouldUpdateTexture = false) {
    target.value = source.value;
    if (shouldUpdateTexture) {
        updateBorderSliderConstraints();
        handleBorderChange(); // handleBorderChange calls updateTexture
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

function updateTexture() {
    if (!originalImage) return;

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    
    // Get the current frame color from the input
    const frameColor = frameColorInput.value;

    const resolution = Math.min(originalImage.width, 2048);
    canvas.width = resolution;
    canvas.height = resolution * (originalImage.height / originalImage.width);

    // Fill the entire canvas with the chosen frame color first.
    // This handles transparent areas of the image and serves as the background for the border.
    ctx.fillStyle = frameColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (borderCheckbox.checked) {
        // When border is checked, draw the image inside the border area.
        // The outer border area will automatically be the 'frameColor' from the initial fill.
        const frameWidthCm = parseFloat(widthNumber.value);
        const frameHeightCm = parseFloat(heightNumber.value);
        const borderCm = parseFloat(borderCmNumber.value);

        const borderPixelsX = (borderCm / frameWidthCm) * canvas.width;
        const borderPixelsY = (borderCm / frameHeightCm) * canvas.height;
        
        const innerX = borderPixelsX;
        const innerY = borderPixelsY;
        const innerWidth = canvas.width - (borderPixelsX * 2);
        const innerHeight = canvas.height - (borderPixelsY * 2);
        
        if (innerWidth > 0 && innerHeight > 0) {
            ctx.drawImage(originalImage, innerX, innerY, innerWidth, innerHeight);
        }

    } else {
        // If no border, draw the image directly onto the frame-colored background
        ctx.drawImage(originalImage, 0, 0, canvas.width, canvas.height);
    }

    if (userImageTexture) {
        userImageTexture.dispose();
    }
    
    userImageTexture = new THREE.CanvasTexture(canvas);
    userImageTexture.colorSpace = THREE.SRGBColorSpace;
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

    const plainMaterial = new THREE.MeshStandardMaterial({ color: frameColor, metalness: 0.1, roughness: 0.8 });
    const textureMaterial = new THREE.MeshStandardMaterial({ map: userImageTexture });

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
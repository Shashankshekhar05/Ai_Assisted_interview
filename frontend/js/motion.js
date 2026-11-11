// AI Interview Pro - Framer Motion-Style Physics & Interactive Animation Engine

document.addEventListener('DOMContentLoaded', () => {
    initHeroParticles();
    initSpotlightEffect();
    init3DCardTilt();
    initAnimatedCounters();
    initMagneticButtons();
});

// ================= 1. INTERACTIVE HERO PARTICLE CANVAS =================
function initHeroParticles() {
    const canvas = document.getElementById('hero-particle-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let width = canvas.width = canvas.parentElement.offsetWidth;
    let height = canvas.height = canvas.parentElement.offsetHeight;

    window.addEventListener('resize', () => {
        if (!canvas.parentElement) return;
        width = canvas.width = canvas.parentElement.offsetWidth;
        height = canvas.height = canvas.parentElement.offsetHeight;
    });

    const particles = [];
    const particleCount = Math.min(55, Math.floor(width / 24));

    for (let i = 0; i < particleCount; i++) {
        particles.push({
            x: Math.random() * width,
            y: Math.random() * height,
            radius: Math.random() * 2 + 0.8,
            vx: (Math.random() - 0.5) * 0.45,
            vy: (Math.random() - 0.5) * 0.45,
            alpha: Math.random() * 0.5 + 0.2,
            color: Math.random() > 0.4 ? '167, 139, 250' : '236, 72, 153'
        });
    }

    let mouseX = width / 2;
    let mouseY = height / 3;

    window.addEventListener('mousemove', (e) => {
        const rect = canvas.getBoundingClientRect();
        mouseX = e.clientX - rect.left;
        mouseY = e.clientY - rect.top;
    });

    function render() {
        ctx.clearRect(0, 0, width, height);

        for (let i = 0; i < particles.length; i++) {
            const p = particles[i];
            p.x += p.vx;
            p.y += p.vy;

            if (p.x < 0) p.x = width;
            if (p.x > width) p.x = 0;
            if (p.y < 0) p.y = height;
            if (p.y > height) p.y = 0;

            // Draw particle
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(${p.color}, ${p.alpha})`;
            ctx.fill();

            // Connect nearby particles
            for (let j = i + 1; j < particles.length; j++) {
                const p2 = particles[j];
                const dx = p.x - p2.x;
                const dy = p.y - p2.y;
                const dist = Math.sqrt(dx * dx + dy * dy);

                if (dist < 110) {
                    ctx.beginPath();
                    ctx.moveTo(p.x, p.y);
                    ctx.lineTo(p2.x, p2.y);
                    ctx.strokeStyle = `rgba(167, 139, 250, ${(1 - dist / 110) * 0.18})`;
                    ctx.lineWidth = 0.75;
                    ctx.stroke();
                }
            }

            // Subtle interaction with mouse
            const dxM = p.x - mouseX;
            const dyM = p.y - mouseY;
            const distM = Math.sqrt(dxM * dxM + dyM * dyM);
            if (distM < 130) {
                const force = (130 - distM) / 130;
                p.x += (dxM / distM) * force * 0.8;
                p.y += (dyM / distM) * force * 0.8;
            }
        }

        requestAnimationFrame(render);
    }

    render();
}

// ================= 2. SPOTLIGHT CURSOR GLOW (RAYCAST / LINEAR EFFECT) =================
function initSpotlightEffect() {
    const cards = document.querySelectorAll('.spotlight-card, .glass-panel-dark, .glass-panel-light, .laptop-chassis');
    
    document.addEventListener('mousemove', (e) => {
        cards.forEach(card => {
            const rect = card.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            card.style.setProperty('--mouse-x', `${x}px`);
            card.style.setProperty('--mouse-y', `${y}px`);
        });
    });
}

// ================= 3. 3D CARD TILT WITH SPRING PHYSICS =================
function init3DCardTilt() {
    const tiltElements = document.querySelectorAll('.tilt-3d, .laptop-chassis');

    tiltElements.forEach(el => {
        el.addEventListener('mousemove', (e) => {
            const rect = el.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            
            const centerX = rect.width / 2;
            const centerY = rect.height / 2;

            const rotateX = ((y - centerY) / centerY) * -5.5; // Max 5.5deg
            const rotateY = ((x - centerX) / centerX) * 5.5;

            el.style.transform = `perspective(1000px) rotateX(${rotateX.toFixed(2)}deg) rotateY(${rotateY.toFixed(2)}deg) scale3d(1.01, 1.01, 1.01)`;
        });

        el.addEventListener('mouseleave', () => {
            el.style.transform = `perspective(1000px) rotateX(0deg) rotateY(0deg) scale3d(1, 1, 1)`;
            el.style.transition = 'transform 0.6s cubic-bezier(0.16, 1, 0.3, 1)';
        });

        el.addEventListener('mouseenter', () => {
            el.style.transition = 'transform 0.15s ease-out';
        });
    });
}

// ================= 4. FRAMER-STYLE ANIMATED NUMBER ROLL-UPS =================
function animateCounter(element, target, duration = 1200, suffix = '') {
    if (!element) return;
    const start = 0;
    const startTime = performance.now();

    function update(now) {
        const elapsed = now - startTime;
        const progress = Math.min(elapsed / duration, 1);
        
        // Easing function: easeOutExpo
        const ease = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);
        const current = Math.floor(start + (target - start) * ease);

        element.innerText = `${current}${suffix}`;

        if (progress < 1) {
            requestAnimationFrame(update);
        } else {
            element.innerText = `${target}${suffix}`;
        }
    }

    requestAnimationFrame(update);
}

function initAnimatedCounters() {
    // Animate stats cards when visible
    const statCards = document.querySelectorAll('.stat-counter');
    
    if ('IntersectionObserver' in window) {
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const el = entry.target;
                    const target = parseInt(el.getAttribute('data-target') || el.innerText, 10);
                    const suffix = el.getAttribute('data-suffix') || '';
                    if (!isNaN(target)) {
                        animateCounter(el, target, 1200, suffix);
                    }
                    observer.unobserve(el);
                }
            });
        }, { threshold: 0.2 });

        statCards.forEach(card => observer.observe(card));
    }
}

// ================= 5. MAGNETIC BUTTONS =================
function initMagneticButtons() {
    const magneticBtns = document.querySelectorAll('.btn-magnetic, .btn-violet');

    magneticBtns.forEach(btn => {
        btn.addEventListener('mousemove', (e) => {
            const rect = btn.getBoundingClientRect();
            const x = e.clientX - rect.left - rect.width / 2;
            const y = e.clientY - rect.top - rect.height / 2;

            btn.style.transform = `translate(${x * 0.15}px, ${y * 0.15}px) scale(1.02)`;
        });

        btn.addEventListener('mouseleave', () => {
            btn.style.transform = `translate(0px, 0px) scale(1)`;
            btn.style.transition = 'transform 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
        });

        btn.addEventListener('mouseenter', () => {
            btn.style.transition = 'transform 0.1s ease-out';
        });
    });
}

// ================= 6. STAGGERED SPRING REVEAL HELPER =================
window.animateTabContent = function(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const children = container.querySelectorAll('.stagger-item');
    children.forEach((child, index) => {
        child.style.opacity = '0';
        child.style.transform = 'translateY(18px)';
        child.style.transition = `all 0.55s cubic-bezier(0.16, 1, 0.3, 1) ${index * 0.07}s`;

        setTimeout(() => {
            child.style.opacity = '1';
            child.style.transform = 'translateY(0px)';
        }, 30);
    });
};

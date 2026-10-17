import 'dotenv/config'; 
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { exec } from 'child_process';
import util from 'util';

const execPromise = util.promisify(exec);

// --- KONFIGURASI SUPABASE ---
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

const DATA_FILE = path.join(process.cwd(), 'coding_data.json');
const PS1_FILE = path.join(process.cwd(), 'get-window.ps1');

// --- FUNGSI ZONA WAKTU LOKAL ---
function getLocalDateString(d) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// --- MAGIC TRICK: MEMBUAT DETEKTOR NATIVE WINDOWS 11 ---
const psScript = `
Add-Type -TypeDefinition '
using System;
using System.Runtime.InteropServices;
public class Win32 {
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll", CharSet=CharSet.Auto)] public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder text, int count);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
}'
$hwnd = [Win32]::GetForegroundWindow()
$pid = 0
[Win32]::GetWindowThreadProcessId($hwnd, [ref]$pid) | Out-Null
$p = Get-Process -Id $pid -ErrorAction SilentlyContinue
$title = New-Object System.Text.StringBuilder 256
[Win32]::GetWindowText($hwnd, $title, 256) | Out-Null
Write-Output "$($p.Name)|||$($title.ToString())"
`;
fs.writeFileSync(PS1_FILE, psScript);

function loadData() {
  if (fs.existsSync(DATA_FILE)) return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  return {};
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

async function getActiveWindow() {
  try {
    const { stdout } = await execPromise(`powershell -ExecutionPolicy Bypass -NoProfile -File "${PS1_FILE}"`);
    const parts = stdout.trim().split('|||');
    if (parts.length === 2) return { owner: { name: parts[0] }, title: parts[1] };
  } catch (e) {
    return null;
  }
  return null;
}

// --- KECERDASAN BARU: DETEKSI BAHASA & KATEGORI ---
function detectLanguage(title) {
  const t = title.toLowerCase();
  if (t.includes('.tsx') || t.includes('.ts')) return 'TypeScript/React';
  if (t.includes('.jsx') || t.includes('.js')) return 'JavaScript';
  if (t.includes('.php')) return 'PHP/Laravel';
  if (t.includes('.css') || t.includes('tailwind')) return 'CSS/Tailwind';
  if (t.includes('.html')) return 'HTML';
  if (t.includes('.json')) return 'JSON';
  return 'Mixed/Other';
}

function analyzeActivity(owner, title) {
  // 1. CODING (VS Code)
  if (owner.includes('Code') || title.includes('Visual Studio Code')) {
    const parts = title.split(' - ');
    const project = parts.length >= 2 ? parts[parts.length - 2] : 'Proyek Tidak Diketahui';
    return { isTracked: true, category: 'Coding', project: project, lang: detectLanguage(title) };
  }
  // 2. DESIGNING (Figma)
  if (title.includes('Figma')) {
    const parts = title.split(' – '); // Figma kadang pakai en-dash
    const project = parts.length > 0 ? parts[0].replace('Figma', '').trim() : 'UI/UX Design';
    return { isTracked: true, category: 'Designing', project: project || 'UI Mockup', lang: 'Design Tools' };
  }
  // 3. TESTING (Localhost)
  if (title.includes('localhost') || title.includes('127.0.0.1')) {
    return { isTracked: true, category: 'Testing', project: 'Local Environment', lang: 'Web Preview' };
  }
  // 4. RESEARCHING (Stack Overflow / GitHub)
  if (title.includes('Stack Overflow') || title.includes('GitHub')) {
    return { isTracked: true, category: 'Researching', project: 'Documentation & Bugs', lang: 'Reading' };
  }
  
  return { isTracked: false };
}

// ==============================================
// LOGIKA UTAMA TRACKER
// ==============================================

let codingData = loadData();
let syncCounter = 0;

console.log("🚀 Advanced Time Tracker (Mode Native Windows) Aktif!");
console.log("Menghubungkan ke Supabase...\n");

setInterval(async () => {
  try {
    const window = await getActiveWindow();
    if (!window || !window.title) return;

    const activity = analyzeActivity(window.owner.name, window.title);

    if (activity.isTracked) {
      const today = getLocalDateString(new Date());

      if (!codingData[today]) codingData[today] = {};
      
      // Penyesuaian struktur JSON lokal agar mendukung multi-data
      if (!codingData[today][activity.project] || typeof codingData[today][activity.project] === 'number') {
        // Jika data lama masih berupa angka biasa, kita ubah jadi object
        const oldDuration = typeof codingData[today][activity.project] === 'number' ? codingData[today][activity.project] : 0;
        codingData[today][activity.project] = { duration: oldDuration, category: activity.category, lang: activity.lang };
      }

      // Tambah 5 detik & update bahasa/kategori terbaru
      codingData[today][activity.project].duration += 5;
      codingData[today][activity.project].category = activity.category;
      codingData[today][activity.project].lang = activity.lang;
      
      saveData(codingData); 

      const totalSeconds = codingData[today][activity.project].duration;
      const minutes = Math.floor(totalSeconds / 60);
      const seconds = totalSeconds % 60;
      
      console.clear();
      console.log(`🚀 Advanced Time Tracker Aktif!\n`);
      console.log(`📂 Kategori   : ${activity.category}`);
      console.log(`💻 Proyek     : ${activity.project}`);
      console.log(`🛠️  Tech/Lang  : ${activity.lang}`);
      console.log(`⏱️  Waktu      : ${minutes} menit ${seconds} detik`);

      // Sinkronisasi ke Supabase tiap 30 detik
      syncCounter += 5;
      if (syncCounter >= 30) {
        syncCounter = 0;
        console.log(`\n☁️  Menyinkronkan data ke Supabase...`);
        
        const { error } = await supabase
          .from('coding_activity')
          .upsert({ 
            date: today, 
            project_name: activity.project, 
            duration_seconds: totalSeconds,
            category: activity.category,
            language: activity.lang
          }, { 
            onConflict: 'date, project_name' 
          });

        if (error) {
          console.error(`❌ Gagal sinkronisasi:`, error.message);
        } else {
          console.log(`✅ Data berhasil disimpan ke awan!`);
        }
      }
    } else {
      console.clear();
      console.log(`🚀 Advanced Time Tracker Aktif!\n`);
      console.log(`💤 Sedang Idle/Membuka: ${window.title.substring(0, 45)}...`);
      console.log(`(Perhitungan waktu dihentikan sementara)`);
    }
  } catch (error) {
    console.error("Error tracker:", error);
  }
}, 5000);
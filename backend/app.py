from flask import Flask, render_template, request, jsonify, redirect, url_for, session, send_from_directory
import sqlite3
import os
import bcrypt
from werkzeug.utils import secure_filename
import logging
from datetime import datetime
from flask import send_file
import zipfile
from io import BytesIO
import json

# Настраиваем логирование
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger('cloud_project')

# ИСПРАВЛЕНО: __name__, static_folder='static', template_folder='templates'
app = Flask(__name__, static_folder='static', template_folder='templates')
app.secret_key = 'cloud-project-secret-key-2026'

# Используем абсолютные пути для надёжности
BASE_DIR = os.path.abspath(os.path.dirname(__file__))
STORAGE_PATH = os.path.abspath(os.path.join(BASE_DIR, '..', 'storage'))
DB_PATH = os.path.abspath(os.path.join(BASE_DIR, 'cloud.db'))

# Создаём необходимые директории
os.makedirs(STORAGE_PATH, exist_ok=True)
os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)

logger.info(f"Базовая директория: {BASE_DIR}")
logger.info(f"Путь к хранилищу: {STORAGE_PATH}")
logger.info(f"Путь к базе данных: {DB_PATH}")

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    with get_db() as conn:
        conn.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL
        )
        ''')
        conn.execute('''
        CREATE TABLE IF NOT EXISTS files (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            path TEXT NOT NULL,
            filename TEXT NOT NULL,
            original_filename TEXT NOT NULL,
            size INTEGER,
            uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        ''')
    logger.info("База данных инициализирована")

@app.route('/')
def index():
    if 'user_id' in session:
        return render_template('dashboard.html', username=session.get('username'))
    else:
        return render_template('login.html')

@app.route('/register', methods=['GET', 'POST'])
def register():
    if request.method == 'POST':
        username = request.form.get('username', '').strip()
        password = request.form.get('password', '')
        
        if not username or not password:
            return jsonify({'error': 'Имя пользователя и пароль обязательны'}), 400
        
        if not username.replace('_', '').isalnum():
            return jsonify({'error': 'Имя пользователя может содержать только буквы, цифры и символ подчеркивания'}), 400
        
        hashed = bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt())
        
        try:
            with get_db() as conn:
                conn.execute(
                    'INSERT INTO users (username, password_hash) VALUES (?, ?)',
                    (username, hashed)
                )
            logger.info(f"Создан новый пользователь: {username}")
            # ИСПРАВЛЕНО: возвращаем JSON вместо redirect
            return jsonify({'success': True, 'message': 'Регистрация успешна'})
        except sqlite3.IntegrityError:
            logger.warning(f"Попытка создания дубликата пользователя: {username}")
            return jsonify({'error': 'Пользователь уже существует'}), 400
    
    return render_template('register.html')


@app.route('/login', methods=['POST'])
def login():
    username = request.form.get('username', '').strip()
    password = request.form.get('password', '')
    
    with get_db() as conn:
        user = conn.execute(
            'SELECT id, password_hash FROM users WHERE username = ?', (username,)
        ).fetchone()
    
    if user and bcrypt.checkpw(password.encode('utf-8'), user['password_hash']):
        session['user_id'] = user['id']
        session['username'] = username
        logger.info(f"Пользователь вошёл в систему: {username}")
        # ИСПРАВЛЕНО: возвращаем JSON вместо redirect
        return jsonify({'success': True, 'message': 'Вход выполнен успешно'})
    else:
        logger.warning(f"Неудачная попытка входа для пользователя: {username}")
        return jsonify({'error': 'Неверное имя или пароль'}), 401

@app.route('/logout')
def logout():
    username = session.get('username', 'unknown')
    session.clear()
    logger.info(f"Пользователь вышел из системы: {username}")
    return redirect(url_for('index'))

@app.route('/files')
def list_files():
    if 'user_id' not in session:
        return jsonify({'error': 'Требуется авторизация'}), 401
    
    user_id = session['user_id']
    user_dir = os.path.join(STORAGE_PATH, str(user_id))
    valid_files = []
    
    os.makedirs(user_dir, exist_ok=True)
    
    with get_db() as conn:
        files = conn.execute(
            '''SELECT id, filename, original_filename, size, uploaded_at 
               FROM files 
               WHERE user_id = ? 
               ORDER BY uploaded_at DESC''',
            (user_id,)
        ).fetchall()
        
        for row in files:
            filepath = os.path.join(user_dir, row['filename'])
            
            if os.path.exists(filepath):
                valid_files.append({
                    'filename': row['original_filename'] if row['original_filename'] else row['filename'],
                    'size': row['size'],
                    'uploaded_at': row['uploaded_at']
                })
            else:
                conn.execute('DELETE FROM files WHERE id = ?', (row['id'],))
    
    return jsonify(valid_files)

@app.route('/upload', methods=['POST'])
def upload_file():
    if 'user_id' not in session:
        return jsonify({'error': 'Требуется авторизация'}), 401
    
    user_id = session['user_id']
    user_dir = os.path.join(STORAGE_PATH, str(user_id))
    os.makedirs(user_dir, exist_ok=True)
    
    if 'files' not in request.files:
        return jsonify({'error': 'Файлы не найдены в запросе'}), 400
    
    files = request.files.getlist('files')
    if not files or all(f.filename == '' for f in files):
        return jsonify({'error': 'Ни один файл не выбран'}), 400
    
    saved_files = []
    for file in files:
        if file.filename == '':
            continue
        
        original_filename = file.filename
        filename = secure_filename(original_filename)
        filepath = os.path.join(user_dir, filename)
        
        counter = 1
        base, ext = os.path.splitext(filename)
        while os.path.exists(filepath):
            filename = f"{base} ({counter}){ext}"
            filepath = os.path.join(user_dir, filename)
            counter += 1
        
        file.save(filepath)
        size = os.path.getsize(filepath)
        relative_path = f"/{user_id}/{filename}"
        
        with get_db() as conn:
            conn.execute(
                '''INSERT INTO files (user_id, path, filename, original_filename, size)
                   VALUES (?, ?, ?, ?, ?)''',
                (user_id, relative_path, filename, original_filename, size)
            )
        
        saved_files.append(filename)
    
    return jsonify({'message': f'Загружено {len(saved_files)} файл(ов)'})

@app.route('/delete/<path:filename>', methods=['DELETE'])
def delete_file(filename):
    if 'user_id' not in session:
        return jsonify({'error': 'Требуется авторизация'}), 401
    
    user_id = session['user_id']
    user_dir = os.path.join(STORAGE_PATH, str(user_id))
    
    with get_db() as conn:
        file_record = conn.execute(
            'SELECT filename FROM files WHERE user_id = ? AND original_filename = ?',
            (user_id, filename)
        ).fetchone()
    
    if not file_record:
        return jsonify({'error': 'Файл не найден'}), 404
    
    safe_filename = file_record['filename']
    filepath = os.path.join(user_dir, safe_filename)
    
    if not os.path.exists(filepath):
        return jsonify({'error': 'Файл не найден'}), 404
    
    os.remove(filepath)
    
    with get_db() as conn:
        conn.execute(
            'DELETE FROM files WHERE user_id = ? AND original_filename = ?',
            (user_id, filename)
        )
    
    return jsonify({'message': 'Файл удалён'})

@app.route('/download/<path:filename>')
def download_file(filename):
    if 'user_id' not in session:
        return jsonify({'error': 'Требуется авторизация'}), 401
    
    user_id = session['user_id']
    user_dir = os.path.join(STORAGE_PATH, str(user_id))
    
    with get_db() as conn:
        file_record = conn.execute(
            'SELECT filename FROM files WHERE user_id = ? AND original_filename = ?',
            (user_id, filename)
        ).fetchone()
    
    if not file_record:
        return jsonify({'error': 'Файл не найден'}), 404
    
    safe_filename = file_record['filename']
    filepath = os.path.join(user_dir, safe_filename)
    
    if not os.path.exists(filepath):
        return jsonify({'error': 'Файл не найден'}), 404
    
    return send_from_directory(user_dir, safe_filename, as_attachment=True)

# ИСПРАВЛЕНО: __name__ == '__main__'
if __name__ == '__main__':
    init_db()
    logger.info("Сервер запускается...")
    logger.info(f"Веб-интерфейс: http://127.0.0.1:5000")
    app.run(host='127.0.0.1', port=5000, debug=True)
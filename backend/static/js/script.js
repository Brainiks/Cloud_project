// Глобальные переменные
let uploadStartTime = 0;
let lastLoaded = 0;
let lastTime = 0;
let selectedFiles = [];

// Инициализация обработчиков событий
document.addEventListener('DOMContentLoaded', function() {
    const dropZone = document.getElementById('dropZone');
    const fileInput = document.getElementById('fileInput');
    const previewContainer = document.getElementById('previewContainer');
    const filePreviewList = document.getElementById('filePreviewList');
    
    // Обработчик выбора файлов через кнопку
    fileInput.addEventListener('change', function(e) {
        handleFileSelect(e.target.files);
    });

    // Обработчики drag & drop
    dropZone.addEventListener('dragover', function(e) {
        e.preventDefault();
        dropZone.classList.add('drag-over');
    });

    dropZone.addEventListener('dragleave', function() {
        dropZone.classList.remove('drag-over');
    });

    dropZone.addEventListener('drop', function(e) {
        e.preventDefault();
        dropZone.classList.remove('drag-over');
        handleFileSelect(e.dataTransfer.files);
    });

    // Загрузка списка файлов при открытии страницы
    loadFileList();
});

// Обработка выбора файлов
function handleFileSelect(files) {
    if (files.length === 0) return;
    
    selectedFiles = Array.from(files);
    updateFilePreview();
}

// Обновление превью выбранных файлов
function updateFilePreview() {
    const previewContainer = document.getElementById('previewContainer');
    const filePreviewList = document.getElementById('filePreviewList');
    
    if (selectedFiles.length === 0) {
        previewContainer.style.display = 'none';
        return;
    }
    
    previewContainer.style.display = 'block';
    filePreviewList.innerHTML = '';
    
    selectedFiles.forEach((file, index) => {
        const filePreview = document.createElement('div');
        filePreview.className = 'file-preview';
        
        // Определяем иконку файла в зависимости от типа
        let icon = '📄';
        if (file.type.startsWith('image/')) icon = '🖼️';
        if (file.type.startsWith('video/')) icon = '🎬';
        if (file.type.startsWith('audio/')) icon = '🎵';
        if (file.name.endsWith('.pdf')) icon = '📕';
        if (file.name.endsWith('.zip') || file.name.endsWith('.rar')) icon = '📦';
        
        filePreview.innerHTML = `
            <div class="file-icon">${icon}</div>
            <div class="file-info">
                <div class="file-name">${escapeHtml(file.name)}</div>
                <div class="file-size">${formatBytes(file.size)}</div>
            </div>
            <button class="file-remove" onclick="removeFile(${index})" title="Удалить файл">×</button>
        `;
        
        filePreviewList.appendChild(filePreview);
    });
}

// Удаление файла из списка выбранных
function removeFile(index) {
    selectedFiles.splice(index, 1);
    updateFilePreview();
}

// Очистка списка выбранных файлов
function clearSelectedFiles() {
    selectedFiles = [];
    document.getElementById('fileInput').value = '';
    updateFilePreview();
}

// Загрузка файлов на сервер
function uploadFiles() {
    if (selectedFiles.length === 0) {
        alert('Выберите файлы для загрузки');
        return;
    }

    // Показываем контейнер с прогрессом
    const progressContainer = document.getElementById('uploadProgressContainer');
    const progressBar = document.getElementById('progressBar');
    const progressText = document.getElementById('progressText');
    const progressTitle = document.getElementById('progressTitle');
    const progressFiles = document.getElementById('progressFiles');
    const progressSpeed = document.getElementById('progressSpeed');
    const status = document.getElementById('status');
    
    progressContainer.style.display = 'block';
    progressTitle.textContent = 'Подготовка к загрузке...';
    progressTitle.className = '';
    progressBar.style.width = '0%';
    progressText.textContent = '0%';
    progressFiles.textContent = `0 из ${selectedFiles.length} файлов`;
    progressSpeed.textContent = '0 КБ/с';
    progressBar.classList.remove('upload-complete', 'upload-error');
    progressBar.classList.add('uploading');
    
    status.innerHTML = '';
    status.className = '';

    // Создаем объект FormData
    const formData = new FormData();
    selectedFiles.forEach(file => {
        formData.append('files', file);
    });

    // Используем XMLHttpRequest вместо fetch для отслеживания прогресса
    const xhr = new XMLHttpRequest();
    uploadStartTime = Date.now();
    lastTime = uploadStartTime;
    lastLoaded = 0;
    
    // Обработчик прогресса загрузки
    xhr.upload.onprogress = function(event) {
        if (event.lengthComputable) {
            const percentComplete = Math.round((event.loaded / event.total) * 100);
            
            // Обновляем прогресс-бар
            progressBar.style.width = percentComplete + '%';
            progressText.textContent = percentComplete + '%';
            
            // Обновляем информацию о скорости
            const currentTime = Date.now();
            const elapsedSeconds = (currentTime - lastTime) / 1000;
            if (elapsedSeconds > 0.5) {
                const bytesLoaded = event.loaded - lastLoaded;
                const speedKBps = Math.round((bytesLoaded / elapsedSeconds) / 1024);
                progressSpeed.textContent = formatSpeed(speedKBps);
                
                lastLoaded = event.loaded;
                lastTime = currentTime;
            }
        }
    };
    
    // Обработчик завершения загрузки
    xhr.onload = function() {
        progressBar.classList.remove('uploading');
        
        if (xhr.status >= 200 && xhr.status < 300) {
            try {
                const result = JSON.parse(xhr.responseText);
                
                // Обновляем прогресс до 100%
                progressBar.style.width = '100%';
                progressText.textContent = '100%';
                progressTitle.textContent = 'Загрузка завершена!';
                progressTitle.classList.add('upload-complete');
                progressFiles.textContent = `${selectedFiles.length} из ${selectedFiles.length} файлов`;
                
                status.innerHTML = `<span class="status-success">${result.message}</span>`;
                
                // Очищаем выбор и обновляем список через 1 секунду
                setTimeout(() => {
                    selectedFiles = [];
                    document.getElementById('fileInput').value = '';
                    updateFilePreview();
                    loadFileList();
                    
                    // Скрываем прогресс через 2 секунды после завершения
                    setTimeout(() => {
                        progressContainer.style.display = 'none';
                    }, 2000);
                }, 1000);
                
            } catch (e) {
                handleError('Ошибка при обработке ответа сервера');
            }
        } else {
            handleError(`Ошибка сервера: ${xhr.status}`);
        }
    };
    
    // Обработчик ошибки
    xhr.onerror = function() {
        handleError('Ошибка сети при загрузке файлов');
    };
    
    xhr.onabort = function() {
        handleError('Загрузка отменена');
    };
    
    // Отправляем запрос
    xhr.open('POST', '/upload', true);
    
    // Добавляем CSRF-токен если нужен (для Flask)
    const csrfToken = document.querySelector('meta[name="csrf-token"]');
    if (csrfToken) {
        xhr.setRequestHeader('X-CSRFToken', csrfToken.content);
    }
    
    xhr.send(formData);
    
    // Функция обработки ошибок
    function handleError(message) {
        progressBar.classList.remove('uploading');
        progressBar.classList.add('upload-error');
        progressTitle.textContent = 'Ошибка загрузки!';
        progressTitle.classList.add('upload-error');
        status.innerHTML = `<span class="status-error">${message}</span>`;
        
        console.error(message);
    }
    
    // Функция форматирования скорости
    function formatSpeed(speedKBps) {
        if (speedKBps < 1024) {
            return `${speedKBps} КБ/с`;
        } else {
            return `${(speedKBps / 1024).toFixed(1)} МБ/с`;
        }
    }
}

// Загрузка списка файлов с сервера
// Загрузка списка файлов с сервера
async function loadFileList() {
    try {
        const response = await fetch('/files');
        if (!response.ok) {
            throw new Error('Не удалось загрузить файлы');
        }
        const files = await response.json();
        const tbody = document.getElementById('fileTableBody');
        const noFilesMsg = document.getElementById('noFilesMessage');
        tbody.innerHTML = '';

        if (files.length === 0) {
            noFilesMsg.style.display = 'block';
            return;
        }

        noFilesMsg.style.display = 'none';
        files.forEach(file => {
            const row = document.createElement('tr');
            
            // ИСПРАВЛЕНО: Добавляем иконку файла по расширению
            let icon = '📄';
            if (file.filename.match(/\.(jpg|jpeg|png|gif|bmp|webp)$/i)) icon = '🖼️';
            else if (file.filename.match(/\.(mp4|avi|mkv|mov|webm)$/i)) icon = '🎬';
            else if (file.filename.match(/\.(mp3|wav|ogg|flac)$/i)) icon = '🎵';
            else if (file.filename.match(/\.(pdf)$/i)) icon = '📕';
            else if (file.filename.match(/\.(zip|rar|7z|tar|gz)$/i)) icon = '📦';
            else if (file.filename.match(/\.(doc|docx)$/i)) icon = '📘';
            else if (file.filename.match(/\.(xls|xlsx)$/i)) icon = '📗';
            else if (file.filename.match(/\.(ppt|pptx)$/i)) icon = '📙';
            
            row.innerHTML = `
                <td>
                    <span style="margin-right: 8px;">${icon}</span>
                    ${escapeHtml(file.filename)}
                </td>
                <td style="text-align: right;">${formatBytes(file.size)}</td>
                <td>${new Date(file.uploaded_at).toLocaleString('ru-RU')}</td>
                <td style="text-align: center;">
                    <div class="action-buttons">
                        <button class="secondary" onclick="downloadFile('${escapeHtml(file.filename)}')">Скачать</button>
                        <button class="danger" onclick="deleteFile('${escapeHtml(file.filename)}')">Удалить</button>
                    </div>
                </td>
            `;
            tbody.appendChild(row);
        });
    } catch (err) {
        console.error(err);
        document.getElementById('status').innerHTML = 
            `<span class="status-error">Ошибка загрузки файлов: ${err.message}</span>`;
    }
}
// Скачивание файла
function downloadFile(filename) {
    window.location.href = `/download/${encodeURIComponent(filename)}`;
}

// Удаление файла
async function deleteFile(filename) {
    if (!confirm(`Вы уверены, что хотите удалить "${filename}"?`)) {
        return;
    }

    try {
        const response = await fetch(`/delete/${encodeURIComponent(filename)}`, {
            method: 'DELETE'
        });

        const result = await response.json();
        if (response.ok) {
            alert('Файл успешно удалён');
            loadFileList();
        } else {
            alert('Ошибка: ' + (result.error || 'Неизвестная ошибка'));
        }
    } catch (err) {
        console.error(err);
        alert('Ошибка сети: ' + err.message);
    }
}

// Вспомогательные функции
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatBytes(bytes) {
    if (bytes === 0) return '0 Б';
    const k = 1024;
    const sizes = ['Б', 'КБ', 'МБ', 'ГБ'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
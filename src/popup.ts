// ─── Task 8.3: Settings UI ────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  const adapterTypeSelect = document.getElementById('adapter-type') as HTMLSelectElement;
  const apiKeyInput = document.getElementById('api-key') as HTMLInputElement;
  const saveBtn = document.getElementById('save-btn') as HTMLButtonElement;
  const messageDiv = document.getElementById('message') as HTMLDivElement;

  // Load existing settings
  const storage = await chrome.storage.local.get(['apiKey', 'adapterType']);
  if (storage.apiKey) {
    apiKeyInput.value = storage.apiKey;
  }
  if (storage.adapterType) {
    adapterTypeSelect.value = storage.adapterType;
  }

  // Handle save button click
  saveBtn.addEventListener('click', async () => {
    const apiKey = apiKeyInput.value.trim();
    const adapterType = adapterTypeSelect.value as 'saulm' | 'openai';

    if (!apiKey) {
      showMessage('Please enter an API key', 'error');
      return;
    }

    // Disable button and show loading state
    saveBtn.disabled = true;
    saveBtn.textContent = 'Validating...';
    messageDiv.style.display = 'none';

    try {
      // Send validation message to background
      const response = await chrome.runtime.sendMessage({
        type: 'VALIDATE_API_KEY',
        payload: { apiKey, adapterType },
      });

      if (response.success) {
        showMessage('API key saved successfully!', 'success');
        apiKeyInput.value = apiKey; // Keep the key visible
      } else {
        showMessage(`Validation failed: ${response.error || 'Unknown error'}`, 'error');
      }
    } catch (error) {
      showMessage(`Error: ${error instanceof Error ? error.message : String(error)}`, 'error');
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save & Validate';
    }
  });

  function showMessage(text: string, type: 'success' | 'error') {
    messageDiv.textContent = text;
    messageDiv.className = `message ${type}`;
    messageDiv.style.display = 'block';
  }
});

document.addEventListener('DOMContentLoaded', () => {
    const targetDateCalculatorBtn = document.getElementById('targetDateCalculatorBtn');
    const targetDateCalculatorModal = document.getElementById('targetDateCalculatorModal');
    const closeModalBtn = document.getElementById('closeModalBtn');
    const startedDateInput = document.getElementById('startedDate');
    const resourceAvailableInput = document.getElementById('resourceAvailable');
    const storyPointEstimateInput = document.getElementById('storyPointEstimate');
    const estimatedTargetDateOutput = document.getElementById('estimatedTargetDate');
    const calculateButton = document.getElementById('calculateTargetDate');
    const developerWeekAsStoryPointsInput = document.getElementById('developerWeekAsStoryPoints');

    // Show modal
    targetDateCalculatorBtn.addEventListener('click', () => {
        targetDateCalculatorModal.style.display = 'block';
    });

    // Hide modal
    closeModalBtn.addEventListener('click', () => {
        targetDateCalculatorModal.style.display = 'none';
    });

    // Hide modal if clicked outside
    window.addEventListener('click', (event) => {
        if (event.target == targetDateCalculatorModal) {
            targetDateCalculatorModal.style.display = 'none';
        }
    });

    // Calculation logic
    calculateButton.addEventListener('click', () => {
        const startedDate = new Date(startedDateInput.value);
        const resourceAvailable = parseFloat(resourceAvailableInput.value);
        const storyPointEstimate = parseFloat(storyPointEstimateInput.value);

        const developerWeekAsStoryPoints = parseFloat(developerWeekAsStoryPointsInput.value) || 8;

        if (isNaN(startedDate.getTime()) || isNaN(resourceAvailable) || isNaN(storyPointEstimate) || resourceAvailable <= 0) {
            estimatedTargetDateOutput.value = "Invalid input";
            return;
        }

        const totalWeeks = storyPointEstimate / developerWeekAsStoryPoints;
        const weeksRequired = totalWeeks / resourceAvailable;

        const targetDate = new Date(startedDate);
        targetDate.setDate(startedDate.getDate() + (weeksRequired * 7)); // Add weeks in days

        estimatedTargetDateOutput.value = targetDate.toDateString();
    });
});
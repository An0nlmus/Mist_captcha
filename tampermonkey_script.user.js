// ==UserScript==
// @name         Решатель Капчи
// @namespace    http://tampermonkey.net/
// @version      3.2
// @description  Решатель Капчи для Mist
// @author       =Mist
// @match        https://world.mist-game.ru/*
// @grant        GM_getResourceURL
// @grant        GM_xmlhttpRequest
// @require      https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.17.0/dist/tf.min.js
//
// @resource     MODEL_JSON https://an0nlmus.github.io/Mist_captcha/model.json
// @resource     SHARD_1    https://an0nlmus.github.io/Mist_captcha/group1-shard1of3.bin
// @resource     SHARD_2    https://an0nlmus.github.io/Mist_captcha/group1-shard2of3.bin
// @resource     SHARD_3    https://an0nlmus.github.io/Mist_captcha/group1-shard3of3.bin
//
// @updateURL    https://raw.githubusercontent.com/An0nlmus/Mist_captcha/main/tampermonkey_script.user.js
// @downloadURL  https://raw.githubusercontent.com/An0nlmus/Mist_captcha/main/tampermonkey_script.user.js
// ==/UserScript==

(function() {
    'use strict';


    const MODEL_H = 60;
    const MODEL_W = 100;
    const NUM_DIGITS = 4;

    let model = null;
    let isSolving = false;


    async function loadModel() {
        if (model) return model;

        const weightMap = {
            'group1-shard1of3.bin': GM_getResourceURL("SHARD_1"),
            'group1-shard2of3.bin': GM_getResourceURL("SHARD_2"),
            'group1-shard3of3.bin': GM_getResourceURL("SHARD_3")
        };

        const modelJsonUrl = GM_getResourceURL("MODEL_JSON");

        try {
            model = await tf.loadGraphModel(modelJsonUrl, {
                fetchFunc: async (url, init) => {
                    for (const [fileName, resourceUrl] of Object.entries(weightMap)) {
                        if (url.includes(fileName)) {
                            return fetch(resourceUrl, init);
                        }
                    }
                    return fetch(url, init);
                }
            });



            tf.tidy(() => {
                const zeroTensor = tf.zeros([1, MODEL_H, MODEL_W, 1]);
                model.execute(zeroTensor);
            });

        } catch (e) {
            console.error(e);
        }
    }


    async function solveCaptcha(imgElement) {
        if (!model) {
            console.warn('Модель не готова.');
            return null;
        }

        return tf.tidy(() => {
            
            let tensor = tf.browser.fromPixels(imgElement);
            tensor = tf.image.resizeBilinear(tensor, [MODEL_H, MODEL_W]);
            tensor = tf.image.rgbToGrayscale(tensor);
            tensor = tensor.toFloat().div(tf.scalar(255.0));
            tensor = tensor.expandDims(0);
            const predictions = model.execute(tensor);
  
            let result = '';
            const predictionArray = Array.isArray(predictions) ? predictions : [predictions];
            
            
            const digits = [];
            for (let i = 0; i < NUM_DIGITS; i++) {
                const digitTensor = predictionArray[i];
                const digitPrediction = digitTensor.dataSync();
                let maxIndex = 0;
                let maxValue = digitPrediction[0];
                
                for (let j = 1; j < digitPrediction.length; j++) {
                    if (digitPrediction[j] > maxValue) {
                        maxValue = digitPrediction[j];
                        maxIndex = j;
                    }
                }
                
                digits.push(maxIndex + 2);
            }
            
            result = digits[2] + '' + digits[1] + '' + digits[0] + '' + digits[3];

            return result;
        });
    }


    function findCaptchaWindow() {
        const captchaImg = document.querySelector('img[src*="captcha"]');
        if (captchaImg) {
            if (captchaImg.dataset.tfjsSolved === "true") return null;
            const form = captchaImg.closest('form');
            if (form) return { form, captchaImg };
        }
        return null;
    }

    function fillAndSubmit(form, captchaText) {
        const input = form.querySelector('input[name="captcha"]');
        if (input) {
            input.value = captchaText;
            input.dispatchEvent(new Event('input', { bubbles: true }));

            const submitBtn = form.querySelector('button.ctrl_ok') || form.querySelector('input[type="submit"]');
            if (submitBtn) {
                // Проверяем, что форма все еще подключена к DOM перед отправкой
                setTimeout(() => {
                    if (document.contains(form) && document.contains(submitBtn)) {
                        submitBtn.click();
                    }
                }, 500 + Math.random() * 500);
            }
        }
    }

    async function checkAndSolveCaptcha() {
        if (isSolving) return;

        const captchaData = findCaptchaWindow();
        if (captchaData) {
            isSolving = true;
            const { form, captchaImg } = captchaData;
            captchaImg.dataset.tfjsSolved = "true";

            await loadModel();

            const processImage = async () => {
                await new Promise(r => setTimeout(r, 200));
                const text = await solveCaptcha(captchaImg);
                if (text && text.length === NUM_DIGITS) {
                    fillAndSubmit(form, text);
                }
                isSolving = false;
            };

            if (captchaImg.complete && captchaImg.naturalHeight !== 0) {
                await processImage();
            } else {
                captchaImg.onload = async () => { await processImage(); };
            }
        }
    }

    
    loadModel();
    const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            if (mutation.addedNodes.length > 0) {
                checkAndSolveCaptcha();
                break;
            }
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('load', checkAndSolveCaptcha);

})();


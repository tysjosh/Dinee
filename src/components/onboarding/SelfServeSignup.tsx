"use client";

import React, { useState, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import {
  SignupFormData,
  SignupFormErrors,
  SignupStep,
  NIGERIAN_STATES,
} from "@/lib/signup/types";
import { MinimalHeader } from "@/components/ui/Header";

/**
 * Props for the SelfServeSignup component
 */
export interface SelfServeSignupProps {
  onComplete: (userId: string, restaurantId: string) => void;
  onCancel?: () => void;
}

/**
 * Signup steps configuration
 */
const SIGNUP_STEPS: SignupStep[] = [
  {
    id: "account",
    title: "Create Account",
    description: "Set up your login credentials",
  },
  {
    id: "business",
    title: "Business Information",
    description: "Tell us about your restaurant",
  },
  {
    id: "documents",
    title: "Verification Documents",
    description: "Upload required business documents",
  },
  {
    id: "confirmation",
    title: "Confirmation",
    description: "Review and complete signup",
  },
];

/**
 * Initial form data
 */
const initialFormData: SignupFormData = {
  account: {
    email: "",
    password: "",
    confirmPassword: "",
  },
  business: {
    restaurantName: "",
    ownerName: "",
    address: "",
    phoneNumber: "",
    city: "",
    state: "",
  },
  documents: {},
};


/**
 * Simple password hash function for client-side
 * Note: In production, use a proper hashing library
 */
async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Validate email format
 */
function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Validate Nigerian phone number format
 */
function isValidNigerianPhone(phone: string): boolean {
  // Accepts formats: +234..., 234..., 0...
  const phoneRegex = /^(\+?234|0)[789][01]\d{8}$/;
  return phoneRegex.test(phone.replace(/\s/g, ""));
}

/**
 * Self-serve signup component for restaurant owners
 * Requirements: 26.1, 26.2
 * - Allows restaurant owners to sign up without platform admin involvement
 * - Collects business verification documents during onboarding
 */
const SelfServeSignup: React.FC<SelfServeSignupProps> = ({
  onComplete,
  onCancel,
}) => {
  const [currentStep, setCurrentStep] = useState(0);
  const [formData, setFormData] = useState<SignupFormData>(initialFormData);
  const [errors, setErrors] = useState<SignupFormErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pageLoading, setPageLoading] = useState(true);

  // Document upload state
  const [businessRegFile, setBusinessRegFile] = useState<File | null>(null);
  const [ownerIdFile, setOwnerIdFile] = useState<File | null>(null);

  // Convex mutations
  const createRestaurantOwner = useMutation(api.signup.createRestaurantOwner);
  const submitVerificationDocuments = useMutation(
    api.signup.submitVerificationDocuments
  );

  useEffect(() => {
    setPageLoading(false);
  }, []);

  /**
   * Validate the current step
   */
  const validateCurrentStep = useCallback((): boolean => {
    const newErrors: SignupFormErrors = {};
    const stepId = SIGNUP_STEPS[currentStep].id;

    switch (stepId) {
      case "account":
        if (!formData.account.email.trim()) {
          newErrors.email = "Email is required";
        } else if (!isValidEmail(formData.account.email)) {
          newErrors.email = "Please enter a valid email address";
        }

        if (!formData.account.password) {
          newErrors.password = "Password is required";
        } else if (formData.account.password.length < 8) {
          newErrors.password = "Password must be at least 8 characters";
        }

        if (!formData.account.confirmPassword) {
          newErrors.confirmPassword = "Please confirm your password";
        } else if (
          formData.account.password !== formData.account.confirmPassword
        ) {
          newErrors.confirmPassword = "Passwords do not match";
        }
        break;

      case "business":
        if (!formData.business.restaurantName.trim()) {
          newErrors.restaurantName = "Restaurant name is required";
        } else if (formData.business.restaurantName.trim().length < 2) {
          newErrors.restaurantName =
            "Restaurant name must be at least 2 characters";
        }

        if (!formData.business.ownerName.trim()) {
          newErrors.ownerName = "Owner name is required";
        }

        if (!formData.business.address.trim()) {
          newErrors.address = "Address is required";
        } else if (formData.business.address.trim().length < 5) {
          newErrors.address = "Please enter a complete address";
        }

        if (!formData.business.phoneNumber.trim()) {
          newErrors.phoneNumber = "Phone number is required";
        } else if (!isValidNigerianPhone(formData.business.phoneNumber)) {
          newErrors.phoneNumber = "Please enter a valid Nigerian phone number";
        }

        if (!formData.business.city.trim()) {
          newErrors.city = "City is required";
        }

        if (!formData.business.state) {
          newErrors.state = "Please select a state";
        }
        break;

      case "documents":
        if (!businessRegFile) {
          newErrors.businessRegistration =
            "Business registration document is required";
        }
        if (!ownerIdFile) {
          newErrors.ownerId = "Owner ID document is required";
        }
        break;
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [currentStep, formData, businessRegFile, ownerIdFile]);


  /**
   * Handle input changes for account fields
   */
  const handleAccountChange = (field: keyof SignupFormData["account"], value: string) => {
    setFormData((prev) => ({
      ...prev,
      account: { ...prev.account, [field]: value },
    }));
    if (errors[field as keyof SignupFormErrors]) {
      setErrors((prev) => ({ ...prev, [field]: undefined }));
    }
  };

  /**
   * Handle input changes for business fields
   */
  const handleBusinessChange = (field: keyof SignupFormData["business"], value: string) => {
    setFormData((prev) => ({
      ...prev,
      business: { ...prev.business, [field]: value },
    }));
    if (errors[field as keyof SignupFormErrors]) {
      setErrors((prev) => ({ ...prev, [field]: undefined }));
    }
  };

  /**
   * Handle file upload for documents
   */
  const handleFileChange = (
    type: "businessRegistration" | "ownerId",
    file: File | null
  ) => {
    if (type === "businessRegistration") {
      setBusinessRegFile(file);
      if (errors.businessRegistration) {
        setErrors((prev) => ({ ...prev, businessRegistration: undefined }));
      }
    } else {
      setOwnerIdFile(file);
      if (errors.ownerId) {
        setErrors((prev) => ({ ...prev, ownerId: undefined }));
      }
    }
  };

  /**
   * Navigate to next step
   */
  const handleNext = useCallback(() => {
    if (validateCurrentStep()) {
      if (currentStep < SIGNUP_STEPS.length - 1) {
        setCurrentStep((prev) => prev + 1);
      }
    }
  }, [currentStep, validateCurrentStep]);

  /**
   * Navigate to previous step
   */
  const handlePrevious = () => {
    if (currentStep > 0) {
      setCurrentStep((prev) => prev - 1);
    }
  };

  /**
   * Handle form submission
   */
  const handleSubmit = async () => {
    if (!validateCurrentStep()) {
      return;
    }

    setIsSubmitting(true);
    setErrors({});

    try {
      // Hash the password
      const passwordHash = await hashPassword(formData.account.password);

      // Create the restaurant owner account
      const result = await createRestaurantOwner({
        email: formData.account.email.toLowerCase().trim(),
        passwordHash,
        restaurantName: formData.business.restaurantName.trim(),
        ownerName: formData.business.ownerName.trim(),
        address: formData.business.address.trim(),
        phoneNumber: formData.business.phoneNumber.trim(),
        city: formData.business.city.trim(),
        state: formData.business.state,
      });

      if (result.success && result.userId && result.restaurantId) {
        // Submit verification documents
        // In production, files would be uploaded to cloud storage first
        const documents = [];
        if (businessRegFile) {
          documents.push({
            type: "business_registration" as const,
            fileName: businessRegFile.name,
            fileUrl: `placeholder://${businessRegFile.name}`, // Placeholder URL
          });
        }
        if (ownerIdFile) {
          documents.push({
            type: "owner_id" as const,
            fileName: ownerIdFile.name,
            fileUrl: `placeholder://${ownerIdFile.name}`, // Placeholder URL
          });
        }

        if (documents.length > 0) {
          await submitVerificationDocuments({
            userId: result.userId,
            restaurantId: result.restaurantId,
            documents,
          });
        }

        // Call completion handler
        onComplete(result.userId, result.restaurantId);
      } else {
        throw new Error("Failed to create account");
      }
    } catch (error) {
      setErrors({
        general:
          error instanceof Error
            ? error.message
            : "Signup failed. Please try again.",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle Enter key for navigation
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Enter" && !isSubmitting) {
        event.preventDefault();
        if (currentStep === SIGNUP_STEPS.length - 1) {
          handleSubmit();
        } else {
          handleNext();
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [currentStep, isSubmitting, handleNext]);


  /**
   * Render step content based on current step
   */
  const renderStepContent = () => {
    const stepId = SIGNUP_STEPS[currentStep].id;

    switch (stepId) {
      case "account":
        return (
          <div className="space-y-6">
            {/* Email */}
            <div>
              <label
                htmlFor="email"
                className="block text-sm font-medium text-white/70 mb-2"
              >
                Email Address
                <span className="text-red-400 ml-1" aria-label="required">*</span>
              </label>
              <input
                id="email"
                type="email"
                value={formData.account.email}
                onChange={(e) => handleAccountChange("email", e.target.value)}
                placeholder="you@restaurant.com"
                className={`input-dark w-full px-4 py-3 rounded-lg ${
                  errors.email ? "border-red-500/50" : ""
                }`}
                disabled={isSubmitting}
                autoFocus
              />
              {errors.email && (
                <p className="mt-2 text-sm text-red-400" role="alert">
                  {errors.email}
                </p>
              )}
            </div>

            {/* Password */}
            <div>
              <label
                htmlFor="password"
                className="block text-sm font-medium text-white/70 mb-2"
              >
                Password
                <span className="text-red-400 ml-1" aria-label="required">*</span>
              </label>
              <input
                id="password"
                type="password"
                value={formData.account.password}
                onChange={(e) => handleAccountChange("password", e.target.value)}
                placeholder="Minimum 8 characters"
                className={`input-dark w-full px-4 py-3 rounded-lg ${
                  errors.password ? "border-red-500/50" : ""
                }`}
                disabled={isSubmitting}
              />
              {errors.password && (
                <p className="mt-2 text-sm text-red-400" role="alert">
                  {errors.password}
                </p>
              )}
            </div>

            {/* Confirm Password */}
            <div>
              <label
                htmlFor="confirmPassword"
                className="block text-sm font-medium text-white/70 mb-2"
              >
                Confirm Password
                <span className="text-red-400 ml-1" aria-label="required">*</span>
              </label>
              <input
                id="confirmPassword"
                type="password"
                value={formData.account.confirmPassword}
                onChange={(e) =>
                  handleAccountChange("confirmPassword", e.target.value)
                }
                placeholder="Re-enter your password"
                className={`input-dark w-full px-4 py-3 rounded-lg ${
                  errors.confirmPassword ? "border-red-500/50" : ""
                }`}
                disabled={isSubmitting}
              />
              {errors.confirmPassword && (
                <p className="mt-2 text-sm text-red-400" role="alert">
                  {errors.confirmPassword}
                </p>
              )}
            </div>
          </div>
        );

      case "business":
        return (
          <div className="space-y-6">
            {/* Restaurant Name */}
            <div>
              <label
                htmlFor="restaurantName"
                className="block text-sm font-medium text-white/70 mb-2"
              >
                Restaurant Name
                <span className="text-red-400 ml-1" aria-label="required">*</span>
              </label>
              <input
                id="restaurantName"
                type="text"
                value={formData.business.restaurantName}
                onChange={(e) =>
                  handleBusinessChange("restaurantName", e.target.value)
                }
                placeholder="Your restaurant name"
                className={`input-dark w-full px-4 py-3 rounded-lg ${
                  errors.restaurantName ? "border-red-500/50" : ""
                }`}
                disabled={isSubmitting}
                autoFocus
              />
              {errors.restaurantName && (
                <p className="mt-2 text-sm text-red-400" role="alert">
                  {errors.restaurantName}
                </p>
              )}
            </div>

            {/* Owner Name */}
            <div>
              <label
                htmlFor="ownerName"
                className="block text-sm font-medium text-white/70 mb-2"
              >
                Owner Name
                <span className="text-red-400 ml-1" aria-label="required">*</span>
              </label>
              <input
                id="ownerName"
                type="text"
                value={formData.business.ownerName}
                onChange={(e) => handleBusinessChange("ownerName", e.target.value)}
                placeholder="Full name of business owner"
                className={`input-dark w-full px-4 py-3 rounded-lg ${
                  errors.ownerName ? "border-red-500/50" : ""
                }`}
                disabled={isSubmitting}
              />
              {errors.ownerName && (
                <p className="mt-2 text-sm text-red-400" role="alert">
                  {errors.ownerName}
                </p>
              )}
            </div>

            {/* Phone Number */}
            <div>
              <label
                htmlFor="phoneNumber"
                className="block text-sm font-medium text-white/70 mb-2"
              >
                Phone Number
                <span className="text-red-400 ml-1" aria-label="required">*</span>
              </label>
              <input
                id="phoneNumber"
                type="tel"
                value={formData.business.phoneNumber}
                onChange={(e) =>
                  handleBusinessChange("phoneNumber", e.target.value)
                }
                placeholder="+234 801 234 5678"
                className={`input-dark w-full px-4 py-3 rounded-lg ${
                  errors.phoneNumber ? "border-red-500/50" : ""
                }`}
                disabled={isSubmitting}
              />
              {errors.phoneNumber && (
                <p className="mt-2 text-sm text-red-400" role="alert">
                  {errors.phoneNumber}
                </p>
              )}
            </div>

            {/* Address */}
            <div>
              <label
                htmlFor="address"
                className="block text-sm font-medium text-white/70 mb-2"
              >
                Street Address
                <span className="text-red-400 ml-1" aria-label="required">*</span>
              </label>
              <textarea
                id="address"
                value={formData.business.address}
                onChange={(e) => handleBusinessChange("address", e.target.value)}
                placeholder="Enter your restaurant address"
                className={`input-dark w-full px-4 py-3 rounded-lg resize-none h-20 ${
                  errors.address ? "border-red-500/50" : ""
                }`}
                disabled={isSubmitting}
              />
              {errors.address && (
                <p className="mt-2 text-sm text-red-400" role="alert">
                  {errors.address}
                </p>
              )}
            </div>

            {/* City and State */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label
                  htmlFor="city"
                  className="block text-sm font-medium text-white/70 mb-2"
                >
                  City
                  <span className="text-red-400 ml-1" aria-label="required">*</span>
                </label>
                <input
                  id="city"
                  type="text"
                  value={formData.business.city}
                  onChange={(e) => handleBusinessChange("city", e.target.value)}
                  placeholder="City"
                  className={`input-dark w-full px-4 py-3 rounded-lg ${
                    errors.city ? "border-red-500/50" : ""
                  }`}
                  disabled={isSubmitting}
                />
                {errors.city && (
                  <p className="mt-2 text-sm text-red-400" role="alert">
                    {errors.city}
                  </p>
                )}
              </div>

              <div>
                <label
                  htmlFor="state"
                  className="block text-sm font-medium text-white/70 mb-2"
                >
                  State
                  <span className="text-red-400 ml-1" aria-label="required">*</span>
                </label>
                <select
                  id="state"
                  value={formData.business.state}
                  onChange={(e) => handleBusinessChange("state", e.target.value)}
                  className={`input-dark w-full px-4 py-3 rounded-lg ${
                    errors.state ? "border-red-500/50" : ""
                  }`}
                  disabled={isSubmitting}
                >
                  <option value="">Select state</option>
                  {NIGERIAN_STATES.map((state) => (
                    <option key={state} value={state}>
                      {state}
                    </option>
                  ))}
                </select>
                {errors.state && (
                  <p className="mt-2 text-sm text-red-400" role="alert">
                    {errors.state}
                  </p>
                )}
              </div>
            </div>
          </div>
        );


      case "documents":
        return (
          <div className="space-y-6">
            <p className="text-white/60 text-sm">
              Please upload the following documents for verification. Accepted
              formats: PDF, JPG, PNG (max 5MB each).
            </p>

            {/* Business Registration */}
            <div>
              <label className="block text-sm font-medium text-white/70 mb-2">
                Business Registration Certificate
                <span className="text-red-400 ml-1" aria-label="required">*</span>
              </label>
              <div
                className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors ${
                  businessRegFile
                    ? "border-emerald-500/50 bg-emerald-500/5"
                    : errors.businessRegistration
                    ? "border-red-500/50"
                    : "border-white/20 hover:border-white/40"
                }`}
              >
                {businessRegFile ? (
                  <div className="flex items-center justify-center gap-3">
                    <svg
                      className="w-6 h-6 text-emerald-500"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                      />
                    </svg>
                    <span className="text-white">{businessRegFile.name}</span>
                    <button
                      type="button"
                      onClick={() => handleFileChange("businessRegistration", null)}
                      className="text-red-400 hover:text-red-300 ml-2"
                      disabled={isSubmitting}
                    >
                      Remove
                    </button>
                  </div>
                ) : (
                  <label className="cursor-pointer">
                    <input
                      type="file"
                      accept=".pdf,.jpg,.jpeg,.png"
                      onChange={(e) =>
                        handleFileChange(
                          "businessRegistration",
                          e.target.files?.[0] || null
                        )
                      }
                      className="hidden"
                      disabled={isSubmitting}
                    />
                    <div className="flex flex-col items-center gap-2">
                      <svg
                        className="w-10 h-10 text-white/40"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                        />
                      </svg>
                      <span className="text-white/60">
                        Click to upload or drag and drop
                      </span>
                    </div>
                  </label>
                )}
              </div>
              {errors.businessRegistration && (
                <p className="mt-2 text-sm text-red-400" role="alert">
                  {errors.businessRegistration}
                </p>
              )}
            </div>

            {/* Owner ID */}
            <div>
              <label className="block text-sm font-medium text-white/70 mb-2">
                Owner ID (National ID, Driver&apos;s License, or Passport)
                <span className="text-red-400 ml-1" aria-label="required">*</span>
              </label>
              <div
                className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors ${
                  ownerIdFile
                    ? "border-emerald-500/50 bg-emerald-500/5"
                    : errors.ownerId
                    ? "border-red-500/50"
                    : "border-white/20 hover:border-white/40"
                }`}
              >
                {ownerIdFile ? (
                  <div className="flex items-center justify-center gap-3">
                    <svg
                      className="w-6 h-6 text-emerald-500"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                      />
                    </svg>
                    <span className="text-white">{ownerIdFile.name}</span>
                    <button
                      type="button"
                      onClick={() => handleFileChange("ownerId", null)}
                      className="text-red-400 hover:text-red-300 ml-2"
                      disabled={isSubmitting}
                    >
                      Remove
                    </button>
                  </div>
                ) : (
                  <label className="cursor-pointer">
                    <input
                      type="file"
                      accept=".pdf,.jpg,.jpeg,.png"
                      onChange={(e) =>
                        handleFileChange("ownerId", e.target.files?.[0] || null)
                      }
                      className="hidden"
                      disabled={isSubmitting}
                    />
                    <div className="flex flex-col items-center gap-2">
                      <svg
                        className="w-10 h-10 text-white/40"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                        />
                      </svg>
                      <span className="text-white/60">
                        Click to upload or drag and drop
                      </span>
                    </div>
                  </label>
                )}
              </div>
              {errors.ownerId && (
                <p className="mt-2 text-sm text-red-400" role="alert">
                  {errors.ownerId}
                </p>
              )}
            </div>
          </div>
        );


      case "confirmation":
        return (
          <div className="space-y-6">
            <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <svg
                  className="w-6 h-6 text-emerald-500 flex-shrink-0 mt-0.5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                <div>
                  <h4 className="text-emerald-400 font-medium">
                    Ready to Complete Signup
                  </h4>
                  <p className="text-white/60 text-sm mt-1">
                    Please review your information below before submitting.
                  </p>
                </div>
              </div>
            </div>

            {/* Summary */}
            <div className="space-y-4">
              <div className="bg-white/5 rounded-lg p-4">
                <h4 className="text-white/70 text-sm font-medium mb-3">
                  Account Details
                </h4>
                <p className="text-white">{formData.account.email}</p>
              </div>

              <div className="bg-white/5 rounded-lg p-4">
                <h4 className="text-white/70 text-sm font-medium mb-3">
                  Business Information
                </h4>
                <div className="space-y-2 text-white">
                  <p>
                    <span className="text-white/60">Restaurant:</span>{" "}
                    {formData.business.restaurantName}
                  </p>
                  <p>
                    <span className="text-white/60">Owner:</span>{" "}
                    {formData.business.ownerName}
                  </p>
                  <p>
                    <span className="text-white/60">Phone:</span>{" "}
                    {formData.business.phoneNumber}
                  </p>
                  <p>
                    <span className="text-white/60">Address:</span>{" "}
                    {formData.business.address}, {formData.business.city},{" "}
                    {formData.business.state}
                  </p>
                </div>
              </div>

              <div className="bg-white/5 rounded-lg p-4">
                <h4 className="text-white/70 text-sm font-medium mb-3">
                  Uploaded Documents
                </h4>
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-white">
                    <svg
                      className="w-4 h-4 text-emerald-500"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                    <span>Business Registration: {businessRegFile?.name}</span>
                  </div>
                  <div className="flex items-center gap-2 text-white">
                    <svg
                      className="w-4 h-4 text-emerald-500"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                    <span>Owner ID: {ownerIdFile?.name}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Terms */}
            <p className="text-white/50 text-sm">
              By clicking &quot;Complete Signup&quot;, you agree to our Terms of
              Service and Privacy Policy. Your documents will be reviewed within
              24-48 hours.
            </p>
          </div>
        );

      default:
        return null;
    }
  };

  const isLastStep = currentStep === SIGNUP_STEPS.length - 1;

  if (pageLoading) {
    return (
      <div className="min-h-screen bg-black">
        <MinimalHeader />
        <div className="flex items-center justify-center min-h-screen">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-emerald-500/30 border-t-emerald-500"></div>
        </div>
      </div>
    );
  }


  return (
    <div className="flex items-center justify-center min-h-screen px-6 py-20">
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: "easeOut" }}
        className="max-w-2xl w-full space-y-8"
      >
        {/* Title */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.1 }}
          className="text-center"
        >
          <h1 className="text-3xl text-white mb-3 text-minimal">
            Create Your Account
          </h1>
          <p className="text-white/70 text-minimal">
            Get started with your restaurant in minutes
          </p>
        </motion.div>

        {/* Progress Indicator */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="card-minimal rounded-xl p-6"
        >
          <div className="flex items-center justify-between mb-4">
            <span className="text-sm font-medium text-white/70">
              Step {currentStep + 1} of {SIGNUP_STEPS.length}
            </span>
            <span className="text-sm text-white/60">
              {Math.round(((currentStep + 1) / SIGNUP_STEPS.length) * 100)}%
              Complete
            </span>
          </div>
          <div className="w-full bg-white/10 rounded-full h-2 overflow-hidden">
            <div
              className="bg-emerald-500 h-2 rounded-full transition-all duration-500 ease-out"
              style={{
                width: `${((currentStep + 1) / SIGNUP_STEPS.length) * 100}%`,
              }}
            />
          </div>

          {/* Step indicators */}
          <div className="flex justify-between mt-4">
            {SIGNUP_STEPS.map((step, index) => (
              <div
                key={step.id}
                className={`flex flex-col items-center ${
                  index <= currentStep ? "text-emerald-400" : "text-white/40"
                }`}
              >
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                    index < currentStep
                      ? "bg-emerald-500 text-white"
                      : index === currentStep
                      ? "bg-emerald-500/20 border-2 border-emerald-500 text-emerald-400"
                      : "bg-white/10 text-white/40"
                  }`}
                >
                  {index < currentStep ? (
                    <svg
                      className="w-4 h-4"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                  ) : (
                    index + 1
                  )}
                </div>
                <span className="text-xs mt-1 hidden sm:block">{step.title}</span>
              </div>
            ))}
          </div>
        </motion.div>

        {/* Main Form */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.3 }}
          className="card-minimal rounded-xl overflow-hidden"
        >
          {/* Header */}
          <div className="px-6 py-6 border-b border-white/10">
            <h2 className="text-xl text-white text-minimal">
              {SIGNUP_STEPS[currentStep].title}
            </h2>
            <p className="text-white/70 mt-1 text-minimal">
              {SIGNUP_STEPS[currentStep].description}
            </p>
          </div>

          {/* Content */}
          <div className="p-6">
            {errors.general && (
              <div
                className="bg-red-500/10 border border-red-500/20 text-red-400 px-4 py-3 rounded-lg mb-6"
                role="alert"
                aria-live="polite"
              >
                {errors.general}
              </div>
            )}

            <AnimatePresence mode="wait">
              <motion.div
                key={currentStep}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.3 }}
              >
                {renderStepContent()}
              </motion.div>
            </AnimatePresence>

            {/* Navigation */}
            <div className="flex justify-between pt-8 mt-8 border-t border-white/10">
              <button
                className="btn-minimal btn-secondary-minimal px-6 py-3 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={currentStep === 0 ? onCancel : handlePrevious}
                disabled={isSubmitting}
              >
                {currentStep === 0 ? "Cancel" : "Previous"}
              </button>

              {isLastStep ? (
                <button
                  className="btn-minimal btn-primary-minimal px-8 py-3 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={handleSubmit}
                  disabled={isSubmitting}
                >
                  {isSubmitting ? (
                    <span className="flex items-center gap-2">
                      <div className="animate-spin rounded-full h-4 w-4 border-2 border-emerald-500/30 border-t-emerald-500"></div>
                      Creating Account...
                    </span>
                  ) : (
                    "Complete Signup"
                  )}
                </button>
              ) : (
                <button
                  className="btn-minimal btn-primary-minimal px-8 py-3 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={handleNext}
                  disabled={isSubmitting}
                >
                  Next
                </button>
              )}
            </div>
          </div>
        </motion.div>

        {/* Login link */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.4 }}
          className="text-center"
        >
          <p className="text-white/60 text-sm">
            Already have an account?{" "}
            <a
              href="/login"
              className="text-emerald-400 hover:text-emerald-300 transition-colors"
            >
              Sign in
            </a>
          </p>
        </motion.div>
      </motion.div>
    </div>
  );
};

export default SelfServeSignup;
